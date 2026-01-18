import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx-js-style';
import * as fs from 'fs';
import * as FormData from 'form-data';

import { Response } from 'express';

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
  getTodayStartDDMMYYYYAdd7,
} from 'src/common/utils/date.util';
import { uploadFilsTemp } from 'src/common/utils/uploadFileIn';
import { CapacityMiddleService } from './capacity-middle.service';
import { isMatch } from 'src/common/utils/allcation.util';
import { parseToNumber } from 'src/common/utils/number.util';
dayjs.extend(isSameOrBefore); // เปิดใช้งาน plugin isSameOrBefore
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class CapacityV2Service {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly uploadTemplateForShipperService: UploadTemplateForShipperService,
    private readonly fileUploadService: FileUploadService,
    private readonly capacityMiddleService: CapacityMiddleService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) { }

  async capacityRequestManagementOnce(id: any) {
    const resData = await this.prisma.contract_code.findMany({
      where: {
        id: Number(id),
      },
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

  // The Contract Code has been applied across different Contract types
  async pathDetailCapacityRequestManagementTranformNew(
    data: any,
    userId: any,
    file: any,
    token: any,
  ) {
    const resultTranform = (await JSON.parse(data?.json_data)) || null;
    // console.log('resultTranform : ', resultTranform);
    const headerEntry = resultTranform?.headerEntry || {};
    const entryValue = resultTranform?.entryValue || [];
    const headerExit = resultTranform?.headerExit || {};
    const exitValue = resultTranform?.exitValue || [];
    const sumEntries = resultTranform?.sumEntries || {};
    const sumExits = resultTranform?.sumExits || {};

    let typeSuccess = 1; // 1 success , 2 warning

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

    if (!typeOfContract) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Type of Contract cannot be blank.', // https://app.clickup.com/t/86ev67ym1
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const typeOfContractText =
      this.capacityMiddleService.typeOfContractTextToNum(typeOfContract);

    const getGroupByName =
      await this.capacityMiddleService.getGroupByName(shipperName);

    if (!getGroupByName) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Shipper Info does not match the value.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const contractPointSp = getGroupByName?.shipper_contract_point.map(
      (cp: any) => {
        return {
          contract_point: cp?.contract_point?.contract_point,
          entry_exit_id: cp?.contract_point?.entry_exit_id,
        };
      },
    );

    if (!typeOfContractText) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Type Term Name is NOT match',
          // error: 'Contract code does not match the term.',
          // error: 'Contract Code is missing in the template.',
          // error: 'Type of Contract not found.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!contractCode) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code not found. Please verify and try again.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const ckUserTypeGroup = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
      include: {
        user_type: true,
      },
    });

    if (ckUserTypeGroup?.user_type_id === 3) {
      if (ckUserTypeGroup?.name !== shipperName) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Contract code does not match the shipper.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (entryValue.length === 0 && exitValue.length === 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'The Capacity Booking must be defined',
        },
        HttpStatus.BAD_REQUEST,
      );
    }


    // ... check head
    console.log('headerEntry : ', headerEntry);
    console.log('headerExit : ', headerExit);

    const requiredEntry = [
      "Capacity Daily Booking (MMBTU/d)",
      "Capacity Daily Booking (MMscfd)",
      "Maximum Hour Booking (MMBTU/h)",
      "Maximum Hour Booking (MMscfh)",
      "Entry",
      "Period",
    ];

    const requiredExit = [
      "Capacity Daily Booking (MMBTU/d)",
      "Maximum Hour Booking (MMBTU/h)",
      "Exit",
      "Period",
    ];

    const missingEntry = requiredEntry.filter(k => !headerEntry?.[k]);
    const missingExit  = requiredExit.filter(k => !headerExit?.[k]);

    const missing = [
      ...missingEntry.map(k => `Entry.${k}`),
      ...missingExit.map(k => `Exit.${k}`),
    ];
  
    if (missing.length > 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: `Template Is Not Match. [${missing.join(', ')}]`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where: {
        term_type_id: Number(typeOfContractText),
        // start_date: {
        //   lte: todayEnd,
        // },
        // end_date: {
        //   gte: todayStart,
        // },
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
            const factor = 1000; // คูณ 1000 เพื่อรักษาทศนิยม 3 ตำแหน่ง

            entryValue.forEach((entry) => {
              if (entry[entryKey] !== undefined) {
                // sum += parseFloat(entry[entryKey]?.replace(/,/g, '')) || 0;
                sum =
                  Math.round(
                    (sum + Number(entry[entryKey]?.replace(/,/g, '')) || 0) *
                      1000,
                  ) / 1000;
                //  const num = parseFloat(entry[entryKey]?.replace(/,/g, '')) || 0;
                //   sum += Math.round(num * factor);

                // sum += Math.round(parseFloat(entry[entryKey]) * factor) / factor || 0;
              }
            });
            checkValueSum.entry[key].push({
              key: entryKey,
              sum,
              // sum: Number(sum.toFixed(3)),
              headerKey: date,
            });
          }
        });
      }
    }
    console.log('--exitValue : ', exitValue);
    // Populate checkValueSum.exit
    for (const key in checkValueSum.exit) {
      if (headerExit[key]) {
        Object.keys(headerExit[key]).forEach((date) => {
          if (date !== 'key') {
            const exitKey = headerExit[key][date]?.key;
            let sum = 0;
            const factor = 1000; // คูณ 1000 เพื่อรักษาทศนิยม 3 ตำแหน่ง

            exitValue.forEach((exit) => {
              if (exit[exitKey] !== undefined) {
                // console.log(parseFloat(exit[exitKey].replace(/,/g, '')) || 0);
                // sum += parseFloat(exit[exitKey]) || 0;
                // console.log('--- : ', exit[exitKey]?.replace(/,/g, ''));
                // console.log('--- : ', Number(exit[exitKey]?.replace(/,/g, '')));
                // sum += Number(exit[exitKey]?.replace(/,/g, '')) || 0;
                sum =
                  Math.round(
                    (sum + Number(exit[exitKey]?.replace(/,/g, '')) || 0) *
                      1000,
                  ) / 1000;
                // sum += Math.round(parseFloat(exit[exitKey]) * factor) / factor || 0;
              }
            });
            // console.log('exitValue : ', exitValue);
            // console.log('sum : ', sum);
            // console.log('----');
            checkValueSum.exit[key].push({
              key: exitKey,
              sum,
              // sum: Number(sum.toFixed(3)),
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
        // const expectedSum = parseFloat(sumEntries[entryKey]) || 0;
        const expectedSum =
          Number(sumEntries[entryKey]?.replace(/,/g, '')) || 0;

        // const decimalPart = calculatedSum.toString().split('.')[1]; // ดึงทศนิยมมาเช็ค
        // let newNum = !!decimalPart && decimalPart.length > 3 ? Number(calculatedSum).toFixed(3) : calculatedSum
        if (String(calculatedSum) !== String(expectedSum)) {
          console.log('1');
          if (String(calculatedSum.toFixed(3)) !== String(expectedSum)) {
            const diff = Math.abs(calculatedSum - expectedSum);
            // console.log('diff : ', diff);
            // console.log(0.001 + Number.EPSILON);
            // console.log(diff > (0.001 + Number.EPSILON));
            if (diff > 0.001 + Number.EPSILON) {
              console.log('calculatedSum : ', calculatedSum);
              console.log(Math.abs(calculatedSum - expectedSum));
              console.log(
                'String(calculatedSum.toFixed(3)) : ',
                String(calculatedSum.toFixed(3)),
              );
              console.log('String(expectedSum) : ', String(expectedSum));
              entryCompareNotMatch.push({
                headerKey, // This will be the date, such as "01/11/2024"
                key: entryKey,
                description: key,
                calculatedSum: calculatedSum,
                expectedSum,
                status: 'Mismatch',
              });
            }
          }
        }
      });
    }

    // Compare checkValueSum.exit with sumExits
    for (const key in checkValueSum.exit) {
      checkValueSum.exit[key].forEach((exitItem) => {
        const { key: exitKey, sum: calculatedSum, headerKey } = exitItem;
        // const expectedSum = parseFloat(sumExits[exitKey]) || 0;
        const expectedSum = Number(sumExits[exitKey]?.replace(/,/g, '')) || 0;

        // const decimalPart = calculatedSum.toString().split('.')[1]; // ดึงทศนิยมมาเช็ค
        // let newNum = !!decimalPart && decimalPart.length > 3 ? Number(calculatedSum).toFixed(3) : calculatedSum
        if (String(calculatedSum) !== String(expectedSum)) {
          console.log('2');
          if (String(calculatedSum.toFixed(3)) !== String(expectedSum)) {
            const diff = Math.abs(calculatedSum - expectedSum);
            // console.log('diff : ', diff);
            // console.log(0.001 + Number.EPSILON);
            // console.log(diff > (0.001 + Number.EPSILON));
            if (diff > 0.001 + Number.EPSILON) {
              exitCompareNotMatch.push({
                headerKey, // This will be the date, such as "01/11/2024"
                key: exitKey,
                description: key,
                calculatedSum: calculatedSum,
                expectedSum,
                status: 'Mismatch',
              });
            }
          }
        }
      });
    }

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
          // console.log('checkValueSum : ', checkValueSum);
          // console.log('exitItem.sum : ', exitItem.sum);
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

    const keyEntryPoint = 0;
    const keyExitPoint = 0;
    const warningData = [];
    let notApproved = false;
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

    const modeDayAndMonth = bookingTemplate?.term_type_id === 4 ? 1 : 2;

    let resultContractCode: any;
    if (contractCode.includes('_Amd')) {
      const match = contractCode.match(/(.*)(_Amd.*)/);
      resultContractCode = [match[1], match[2]];
    } else {
      resultContractCode = [contractCode];
    }
    let contract_code = resultContractCode[0];

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
        contract_code: contract_code,
      },
    });
    if (checkContractCode) {
      // ck type
      console.log('checkContractCode : ', checkContractCode);
      if (checkContractCode?.term_type_id !== typeOfContractText) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error:
              'The Contract Code has been applied across different Contract types',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    function parseNumericStrict(v: unknown, ctx: {capacityKey: string; dateKey: string; ePointName: string; stamp: string}) {
      // รับ number ตรง ๆ
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) {
          throw new HttpException({
            status: HttpStatus.BAD_REQUEST,
            error: `Invalid number (NaN/Infinity) for ${ctx.capacityKey} at [Date: ${ctx.dateKey}] in ${ctx.ePointName} ${ctx.stamp}`,
          }, HttpStatus.BAD_REQUEST);
        }
        return v;
      }

      // รับ string ที่มี comma ได้ เช่น "1,000.000"
      if (typeof v === 'string') {
        const s = v.trim();
        // if (s === '') {
        //   throw new HttpException({
        //     status: HttpStatus.BAD_REQUEST,
        //     error: `Empty value for ${ctx.capacityKey} at [Date: ${ctx.dateKey}] in ${ctx.ePointName} ${ctx.stamp}`,
        //   }, HttpStatus.BAD_REQUEST);
        // }

        const cleaned = s.replace(/,/g, ''); // ตัด comma ออก
        // เคร่งครัด: อนุญาตเครื่องหมาย +/-, เลข, จุดทศนิยมครั้งเดียว
        if (!/^[-+]?\d*(\.\d+)?$/.test(cleaned)) {
          throw new HttpException({
            status: HttpStatus.BAD_REQUEST,
            error: `Non-numeric value "${v}" for ${ctx.capacityKey} at [Date: ${ctx.dateKey}] in ${ctx.ePointName} ${ctx.stamp}`,
          }, HttpStatus.BAD_REQUEST);
        }

        const n = Number(cleaned);
        if (!Number.isFinite(n)) {
          throw new HttpException({
            status: HttpStatus.BAD_REQUEST,
            error: `Invalid number "${v}" for ${ctx.capacityKey} at [Date: ${ctx.dateKey}] in ${ctx.ePointName} ${ctx.stamp}`,
          }, HttpStatus.BAD_REQUEST);
        }
        return n;
      }

      // ชนิดอื่น ๆ ไม่รับ
      throw new HttpException({
        status: HttpStatus.BAD_REQUEST,
        error: `Unsupported type for ${ctx.capacityKey} at [Date: ${ctx.dateKey}] in ${ctx.ePointName} ${ctx.stamp}`,
      }, HttpStatus.BAD_REQUEST);
    }


    const newEntry = await Promise.all(
      entryValue.map(async (e: any, i: any) => {
        const entryPointName = e[keyEntryPoint];

      

        const newStartDayPlus = dayjs(todayStart);
        const useStart = dayjs(e[keyEntryFrom], 'DD/MM/YYYY');
        const useEnd = dayjs(e[keyEntryTo], 'DD/MM/YYYY');

        if(!useStart.isValid() || !useEnd.isValid()) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Missing Period From or Period To value.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;
        if (!isCheckMoreDate) {
          console.log('1');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if(useStart.isSameOrAfter(useEnd)) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: "The 'Period To' date must not be earlier than the 'Period From' date.",
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.capacityMiddleService.checkDateRange(
          e[keyEntryFrom],
          e[keyEntryTo],
          // modeDayAndMonth,
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );

        if (!checkMinMax) {
          console.log('Date is NOT match 1.1');
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
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);

                  const isInRangeZero = dayjs(dateKey, 'DD/MM/YYYY').isBetween(
                    dayjs(e[keyEntryFrom], 'DD/MM/YYYY'),
                    dayjs(e[keyEntryTo], 'DD/MM/YYYY'),
                    'month',
                    '[]',
                  );

                  if (
                    modeDayAndMonth === 2 &&
                    dayjs(dateKey, 'DD/MM/YYYY').format('DD') !== '01'
                  ) {
                    console.log('2');
                    throw new HttpException(
                      {
                        status: HttpStatus.BAD_REQUEST,
                        error: 'Date is NOT match',
                      },
                      HttpStatus.BAD_REQUEST,
                    );
                  }

                  if (!isInRangeZero || e[keyValue] < 0) {
                    console.log('3');
                    throw new HttpException(
                      {
                        status: HttpStatus.BAD_REQUEST,
                        error: 'Date is NOT match.',
                      },
                      HttpStatus.BAD_REQUEST,
                    );
                  }

                    const s = String(e[keyValue]).trim();
                    if (s === '') {
                        warningData.push(
                        `${capacityKey} for [Date : ${dateKey}] is ${e[keyValue]} at ${entryPointName} ${dayjs(newData, 'YYYY/MM/DD HH:mm').format('DD/MM/YYYY HH:mm')}`,
                      );
                    }

                  const checkNoNum = parseNumericStrict(e[keyValue], {
                    capacityKey,
                    dateKey,
                    ePointName: entryPointName,
                    stamp: dayjs(newData, 'YYYY/MM/DD HH:mm').format('DD/MM/YYYY HH:mm'),
                  });


                  if (Number(e[keyValue]) === 0) {
                    warningData.push(
                      `${capacityKey} for [Date : ${dateKey}] is ${e[keyValue]} at ${entryPointName} ${dayjs(newData, 'YYYY/MM/DD HH:mm').format('DD/MM/YYYY HH:mm')}`,
                    );
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

        const getContractPointByName =
          await this.capacityMiddleService.getContractPointByName(
            entryPointName,
            getGroupByName?.id || null,
          );

        if (!getContractPointByName) {
          notApproved = true;
          warningData.push(
            `Entry Point: ${entryPointName} not match system ${newData}`,
          );
        } else {
          const findCPS = contractPointSp.find((fCPS: any) => {
            return fCPS?.contract_point === entryPointName;
          });
          if (!findCPS) {
            typeSuccess = 2;
            notApproved = true;
            warningData.push(
              `Entry Point: ${entryPointName} not match system ${newData}`,
            );
          }
        }

        const contractPoints = await this.prisma.contract_point.findFirst({
          where: {
            contract_point: e['0'],
            entry_exit_id: 1,
            //
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
            area: true,
            zone: true,
          },
        });

        if (!entryPointName) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Contract Point cannot be blank.', // https://app.clickup.com/t/86ev67nfc
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        return {
          data: e,
          contract_point: e['0'],
          area: contractPoints?.area?.name || null,
          zone: contractPoints?.zone?.name || null,
          contractPointName: entryPointName || null,
        };
      }),
    );

   

    // warningData


    const newExit = await Promise.all(
      exitValue.map(async (e: any, i: any) => {
        const exitPointName = e[keyExitPoint];

        const newStartDayPlus = dayjs(todayStart);
        const useStart = dayjs(e[keyExitFrom], 'DD/MM/YYYY');
        const useEnd = dayjs(e[keyExitTo], 'DD/MM/YYYY');

        if(!useStart.isValid() || !useEnd.isValid()) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Missing Period From or Period To value.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        
        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;

        if (!isCheckMoreDate) {
          // console.log('keyExitFrom : ', keyExitFrom);
          // console.log('e[keyExitFrom] : ', e[keyExitFrom]);
          // console.log('newStartDayPlus : ', newStartDayPlus);
          // console.log('useStart : ', useStart);
          // console.log('isCheckMoreDate : ', isCheckMoreDate);
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if(useStart.isSameOrAfter(useEnd)) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: "The 'Period To' date must not be earlier than the 'Period From' date.",
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.capacityMiddleService.checkDateRange(
          e[keyExitFrom],
          e[keyExitTo],
          // modeDayAndMonth,
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );
        if (!checkMinMax) {
          console.log('---4');

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
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);

                  const isInRangeZero = dayjs(dateKey, 'DD/MM/YYYY').isBetween(
                    dayjs(e[keyEntryFrom], 'DD/MM/YYYY'),
                    dayjs(e[keyEntryTo], 'DD/MM/YYYY'),
                    'month',
                    '[]',
                  );

                  if (
                    modeDayAndMonth === 2 &&
                    dayjs(dateKey, 'DD/MM/YYYY').format('DD') !== '01'
                  ) {
                    console.log('5');
                    throw new HttpException(
                      {
                        status: HttpStatus.BAD_REQUEST,
                        error: 'Date is NOT match',
                      },
                      HttpStatus.BAD_REQUEST,
                    );
                  }

                    const s = String(e[keyValue]).trim();
                    if (s === '') {
                        warningData.push(
                        `${capacityKey} for [Date : ${dateKey}] is ${e[keyValue]} at ${exitPointName} ${dayjs(newData, 'YYYY/MM/DD HH:mm').format('DD/MM/YYYY HH:mm')}`,
                      );
                    }

                  const checkNoNum = parseNumericStrict(e[keyValue], {
                    capacityKey,
                    dateKey,
                    ePointName: exitPointName,
                    stamp: dayjs(newData, 'YYYY/MM/DD HH:mm').format('DD/MM/YYYY HH:mm'),
                  });

                  if (Number(e[keyValue]) === 0) {
                    warningData.push(
                      `${capacityKey} for [Date : ${dateKey}] is ${e[keyValue]} at ${exitPointName} ${dayjs(newData, 'YYYY/MM/DD HH:mm').format('DD/MM/YYYY HH:mm')}`,
                    );
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

        const getContractPointByName =
          await this.capacityMiddleService.getContractPointByName(
            exitPointName,
            getGroupByName?.id || null,
          );
        if (!getContractPointByName) {
          notApproved = true;
          warningData.push(
            `Exit Point: ${exitPointName} not match system ${newData}`,
          );
        } else {
          const findCPS = contractPointSp.find((fCPS: any) => {
            return fCPS?.contract_point === exitPointName;
          });
          if (!findCPS) {
            typeSuccess = 2;
            notApproved = true;
            warningData.push(
              `Exit Point: ${exitPointName} not match system ${newData}`,
            );
          }
        }

        const contractPoints = await this.prisma.contract_point.findFirst({
          where: {
            contract_point: e['0'],
            entry_exit_id: 2,
            //
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
            area: true,
            zone: true,
          },
        });

         if (!exitPointName) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Contract Point cannot be blank.', // https://app.clickup.com/t/86ev67nfc
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        return {
          data: e,
          contract_point: e['0'],
          area: contractPoints?.area?.name || null,
          zone: contractPoints?.zone?.name || null,
          contractPointName: exitPointName || null,
        };
      }),
    );

    // console.log('warningData : ', warningData);

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

    if (checkContractCode) {
      // มี
      if (shipperName !== checkContractCode?.group?.name) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: `ไม่สามารถใช้ Contract Code: ${contractCode} ถูกใช้งานแล้ว`,
            error: 'Shipper Name Is NOT MATCH',
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
      //
      const dEntryArray = Object.values(dEntryA);
      for (let i = 0; i < dEntryArray.length; i++) {
        const calcCheckEntry =
          await this.capacityMiddleService.validateDateEntries(
            dEntryArray[i],
            // bookingTemplate?.file_period_mode,
            modeDayAndMonth,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );

        const objCalcEntry =
          this.capacityMiddleService.extractValidationResults(
            calcCheckEntry?.date,
          );
        const findCalcEntry = objCalcEntry.filter((f: any) => {
          return f === false;
        });

        if (findCalcEntry.length > 0) {
          console.log('---1');
          console.log('findCalcEntry : ', findCalcEntry);
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Period Capacity Right is NOT Match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      const dExitArray = Object.values(dExitA);
      for (let i = 0; i < dExitArray.length; i++) {
        const calcCheckExit =
          await this.capacityMiddleService.validateDateEntries(
            dExitArray[i],
            // bookingTemplate?.file_period_mode,
            modeDayAndMonth,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
        const objCalcExit = this.capacityMiddleService.extractValidationResults(
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
    } else {
      if (!dEntryA || !dExitA) {
        // https://app.clickup.com/t/86eujxj3q
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'The Capacity Booking must be defined.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const dEntryArray = Object.values(dEntryA);
      for (let i = 0; i < dEntryArray.length; i++) {
        const calcCheckEntry =
          await this.capacityMiddleService.validateDateEntries(
            dEntryArray[i],
            // bookingTemplate?.file_period_mode,
            modeDayAndMonth,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
        console.log('calcCheckEntry : ', calcCheckEntry);
        const objCalcEntry =
          this.capacityMiddleService.extractValidationResults(
            calcCheckEntry?.date,
          );
        const findCalcEntry = objCalcEntry.filter((f: any) => {
          return f === false;
        });

        if (findCalcEntry.length > 0) {
          console.log('---2');
          console.log('findCalcEntry : ', findCalcEntry);
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Period Capacity Right is NOT Match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      const dExitArray = Object.values(dExitA);
      for (let i = 0; i < dExitArray.length; i++) {
        const calcCheckExit =
          await this.capacityMiddleService.validateDateEntries(
            dExitArray[i],
            // bookingTemplate?.file_period_mode,
            modeDayAndMonth,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
        const objCalcExit = this.capacityMiddleService.extractValidationResults(
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

    if (entryCompareNotMatch.length > 0) {
      console.log('entryCompareNotMatch : ', entryCompareNotMatch);
      console.log('Total Entry & Total Exit is NOT match. 1');

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
      console.log('exitCompareNotMatch : ', exitCompareNotMatch);
      console.log('Total Entry & Total Exit is NOT match. 2');

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
      // exitSum
      console.log('compareEntryExit : ', compareEntryExit);
      console.log('Total Entry & Total Exit is NOT match. 3');

      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: compareEntryExit,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    console.log(' - - - 1 - - - ');
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
      //
      // if(getTodayNowAdd7(checkContractCodeCheckLast?.terminate_date).isSameOrBefore(getTodayNowAdd7())){
      //   throw new HttpException(
      //   {
      //     status: HttpStatus.BAD_REQUEST,
      //     error: 'Contract Code End | Terminate',
      //   },
      //   HttpStatus.BAD_REQUEST,
      // );
      // }
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

    let idTemp = null;
    let tyTmp = null;

    // https://app.clickup.com/t/86erqt8g5
    const ckAreaDup = [...newEntry, ...newExit]?.map((ar: any) => ar?.area);
    const hasDuplicate = new Set(ckAreaDup).size !== ckAreaDup.length;



    if (hasDuplicate) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Duplicate Contract Point found.',
          // error: 'Area is Contract Point Duplicate.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    console.log(' - - - 2 - - - ');
    // console.log('process...');
    // console.time('status');
    // console.timeEnd('status');

    if (newCreate) {
      console.log('--- create ---');
      const shadowPeriod = this.capacityMiddleService.genMD(
        minDate,
        dayjs(maxDate, 'DD/MM/YYYY').subtract(1, 'day').format('DD/MM/YYYY'),
        modeDayAndMonth,
      );

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
          // shadow_period: bookingTemplate?.shadow_period,
          shadow_period: (!!shadowPeriod && Number(shadowPeriod)) || null,
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
      idTemp = createContractCode?.id;
      tyTmp = 'created';
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
          contract_start_date: minDate
            ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
            : null,
          contract_end_date: maxDate
            ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
            : null,
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
      // submission_comment_capacity_request_management
      const responseUpFile = await uploadFilsTemp(file);
      await this.capacityMiddleService.fileCapacityBooking(
        responseUpFile?.file?.url,
        createContractCode?.id,
        userId,
      );
      console.log(' - - - 3 - - - ');
      // warningData.length <= 0
      // เช็ค contract point ผิด/ไม่ถูกไม่ให้ tso เปลี่ยนเป็น approved
      if (ckUserType?.id === 2 && !notApproved) {
        if (typeSuccess === 1) {
          try {
            await this.updateStatusCapacityRequestManagement(
              createContractCode?.id,
              {
                status_capacity_request_management_id: 2,
                terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
              },
              userId,
              null,
            );
          } catch (error) {
            console.log('1');
            console.log(error);
            console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
          }
        }
      }
    } else {
      console.log('--- edit ---');
      if (versionFlag) {
        console.log('v');
        const shadowPeriod = this.capacityMiddleService.genMD(
          minDate,
          dayjs(maxDate, 'DD/MM/YYYY').subtract(1, 'day').format('DD/MM/YYYY'),
          modeDayAndMonth,
        );
        console.log(' - - - c0');
        await this.prisma.contract_code.update({
          where: {
            id: checkContractCodeCheckLast?.id,
          },
          data: {
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management: {
                connect: {
                  id: 1,
                  // checkContractCodeCheckLast?.status_capacity_request_management_id ===
                  // 3
                  //   ? 1
                  //   : checkContractCodeCheckLast?.status_capacity_request_management_id,
                },
              },
            }),
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management_process: {
                connect: {
                  id: 3,
                  // checkContractCodeCheckLast?.status_capacity_request_management_id ===
                  // 3
                  //   ? 3
                  //   : checkContractCodeCheckLast?.status_capacity_request_management_process_id,
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
            shadow_period: shadowPeriod ? Number(shadowPeriod) : 0,
          },
        });

        idTemp = checkContractCodeCheckLast?.id;
        tyTmp = 'version';

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
                      : (checkContractCodeCheckLast?.status_capacity_request_management_id == 2 || checkContractCodeCheckLast?.status_capacity_request_management_id == 4) &&
                          (ckUserType?.id != 2 ||
                            notApproved ||
                            typeSuccess !== 1)
                        ? 1
                        : checkContractCodeCheckLast?.status_capacity_request_management_id,
                },
              },
            }),
            contract_start_date: minDate
              ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
              : null,
            contract_end_date: maxDate
              ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
              : null,
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
        console.log(' - - - c1');
        await this.prisma.booking_row_json.createMany({
          data: mapDataRowJson,
        });
        console.log(' - - - c1.5');

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
        console.log(' - - - c1.6');

        const responseUpFile = await uploadFilsTemp(file);
        await this.capacityMiddleService.fileCapacityBooking(
          responseUpFile?.file?.url,
          checkContractCodeCheckLast?.id,
          userId,
        );
        console.log(' - - - c2');

        if (ckUserType?.id === 2 && !notApproved) {
          if (typeSuccess === 1) {
            try {
              await this.updateStatusCapacityRequestManagement(
                checkContractCodeCheckLast?.id,
                {
                  status_capacity_request_management_id: 2,
                  terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
                  // shadow_time: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
                  // shadow_period: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
                  // reject_reasons: null, //"comment.." //status_capacity_request_management_id 3 ต้องมี ไม่ 3 ให้ null
                },
                userId,
                null,
                true,
              );
            } catch (error) {
              console.log('2');
              console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
            }
          }
        }
      } else if (amdFlag) {
        console.log('amd');
        const shadowPeriod = this.capacityMiddleService.genMD(
          minDate,
          dayjs(maxDate, 'DD/MM/YYYY').subtract(1, 'day').format('DD/MM/YYYY'),
          modeDayAndMonth,
        );
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
        const configStart = extendContractLast
          ? dayjs(extendContractLast?.start_date).format('DD/MM/YYYY')
          : dayjs(minDate, 'DD/MM/YYYY').format('DD/MM/YYYY');
        const configEnd = extendContractLast
          ? dayjs(extendContractLast?.end_date).format('DD/MM/YYYY')
          : dayjs(maxDate, 'DD/MM/YYYY').format('DD/MM/YYYY');

        const resCk = await this.capacityMiddleService.validateEndDate({
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
          // console.log('--amd');
          console.log('---1');

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
                  id: dayjs(minDate, 'DD/MM/YYYY').isSameOrBefore(
                    dayjs(),
                    'day',
                  )
                    ? 1
                    : 2,
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
              // shadow_period: checkContractCodeCheckLast?.shadow_period,
              shadow_period: shadowPeriod ? Number(shadowPeriod) : 0,
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

          idTemp = createContractCodeAmd?.id;
          tyTmp = 'amd';

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
              contract_start_date: minDate
                ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
                : null,
              contract_end_date: maxDate
                ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
                : null,
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
          await this.capacityMiddleService.fileCapacityBooking(
            responseUpFile?.file?.url,
            createContractCodeAmd?.id,
            userId,
          );

          try {
            //terminate เก่า
            // ยังไม่ได้รองรับจากปุ่ม amd เพิ่ม field termidate
            // ละเว้น Error: Cannot read properties of null (reading 'booking_row_json')
            console.log('minDate : ', minDate);
            let newTerminateDate = null;
            if (minDate) {
              const terminateDate = getTodayNowDDMMYYYYDfaultAdd7(minDate);
              const contractStartDate = getTodayNowDDMMYYYYDfaultAdd7(
                checkContractCodeCheckLast.contract_start_date,
              );
              const contractEndDate = getTodayNowDDMMYYYYDfaultAdd7(
                checkContractCodeCheckLast.contract_end_date,
              );
              if (terminateDate.isBefore(contractStartDate, 'day')) {
                newTerminateDate = contractStartDate.toDate();
              } else if (terminateDate.isAfter(contractEndDate, 'day')) {
                newTerminateDate = contractEndDate.toDate();
              } else {
                newTerminateDate = terminateDate.toDate();
              }
            }
            console.log('===  newTerminateDate; ', newTerminateDate);
            console.log('===  checkContractCodeCheckLast; ', checkContractCodeCheckLast);
            await this.updateStatusCapacityRequestManagement(
              checkContractCodeCheckLast?.id,
              {
                status_capacity_request_management_id: 5,
                terminate_date: newTerminateDate,

                // shadow_time: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
                // shadow_period: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
                // reject_reasons: null, //"comment.." //status_capacity_request_management_id 3 ต้องมี ไม่ 3 ให้ null
              },
              userId,
              null,
            );
          } catch (error) {
            console.log('3');
            console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
          }

          try {
            console.log('createContractCodeAmd : ', createContractCodeAmd);
            await this.updateStatusCapacityRequestManagement(
              createContractCodeAmd?.id,
              {
                status_capacity_request_management_id: 2,
                terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
                // shadow_time: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
                // shadow_period: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
                // reject_reasons: null, //"comment.." //status_capacity_request_management_id 3 ต้องมี ไม่ 3 ให้ null
              },
              userId,
              null,
            );
          } catch (error) {
            console.log('4');
            console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
          }
        } else {
          console.log('---2');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date mismatch: Fails shadow time/period check.',
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
      id: idTemp,
      event: tyTmp,
      type: warningData?.length > 0 ? 2 : typeSuccess,
      warningData: warningData,
      remarkWarningData: `warningData.length > 0 คือมี warning`,
      message:
        warningData?.length > 0 ? `Blank Or 0 value detected in the template.` :
        typeSuccess === 1
          ? 'Success.'
          : 'Zone, Area or Contract point is NOT match.',
      remark: `type 1 = Success, 2 = Warning`,
    };
  }

  async restorePreviousVersion(id: any, terminateDate?: any, userId?:any) {
    console.log('คืนค่าเก่า----');
    const specificVersion = await this.prisma.booking_version.findFirst({
      where: {
        contract_code_id: Number(id),
        // flag_use: false,
        // status_capacity_request_management_id: 2,
      },
      include:{
        contract_code:true,
      },
      orderBy: { id: 'desc' },
    });
    if (specificVersion) {
      // specificVersion?.contract_code?.terminate_date
      // terminate_date
      const { pnmatchData, setDataUse, logWarnings, oldsetDataUse } =
        await this.capacityMiddleService.middleBooking(
          id,
          true,
          specificVersion.id,
        );

        // @@@
      let tsetDataUse = []
      if(terminateDate){
        console.log('******* terminateDate Day : ', dayjs(terminateDate).format("YYYY-MM-DD"));
        tsetDataUse = setDataUse?.map((sd:any) => {
          const { resCalcNew, ...nSd } = sd
          const nresCalcNew = resCalcNew?.map((rCn:any) => {
            const { calcNew, ...nRCn } = rCn
            const fcalcNew = calcNew?.filter((f:any) => {
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
  
      }else{
        tsetDataUse = setDataUse
      }
      
      console.log('คืน ---- tsetDataUse : ', tsetDataUse);
      await this.capacityMiddleService.processGenPublicData(tsetDataUse, true);
   
      // await this.capacityMiddleService.processGenPublicData(setDataUse, true);
    }
  }

  async updateStatusCapacityRequestManagement(
    id: any,
    payload: any,
    userId: any,
    req: any,
    isRestorePreviousVersionValue = false,
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

    console.log('process...');
    console.time('status');
    if (status_capacity_request_management_id === 2) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        // shadow_time: shadow_time,
        // shadow_period: shadow_period,
        status_capacity_request_management_process: {
          connect: {
            id: 2,
          },
        },
      };
      console.log('useData --- : ', useData);
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
      let newTerminateDate = null;
      const terminateDay = getTodayNowAdd7(terminate_date).startOf('day');
      const todayDay = getTodayNowAdd7().startOf('day');

      const isTerminateTodayOrBefore = terminateDay.isSameOrBefore(
        todayDay,
        'day',
      );
      console.log('terminate_date : ', terminate_date);
      const checkContractCodeCheckLast =
        await this.prisma.contract_code.findFirst({
          where: { id: Number(id) },
          select: {
            contract_start_date: true,
            contract_end_date: true,
          },
        });
      const contractStartDate = getTodayNowDDMMYYYYDfaultAdd7(
        checkContractCodeCheckLast.contract_start_date,
      );
      const contractEndDate = getTodayNowDDMMYYYYDfaultAdd7(
        checkContractCodeCheckLast.contract_end_date,
      );
      if (terminateDay.isBefore(contractStartDate, 'day')) {
        newTerminateDate = contractStartDate.toDate();
      } else if (terminateDay.isAfter(contractEndDate, 'day')) {
        newTerminateDate = contractEndDate.toDate();
      } else {
        newTerminateDate = terminateDay.toDate();
      }
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        terminate_date: terminate_date ? newTerminateDate : null,

        status_capacity_request_management_process: {
          connect: {
            id: isTerminateTodayOrBefore ? 4 : 1,
            // id: 4,
          },
        },
      };
    } else if (status_capacity_request_management_id === 4) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
      };
    } else {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'status is not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    console.timeEnd('status');

    console.log('process 2...');

    if (
      status_capacity_request_management_id === 2 ||
      status_capacity_request_management_id === 4
    ) {
      console.time('middleBooking process...');

      if (
        status_capacity_request_management_id === 2 &&
        isRestorePreviousVersionValue == true
      ) {
        // คืนค่าเก่า
        await this.restorePreviousVersion(id);
      }
      const { pnmatchData, setDataUse, logWarnings } =
        await this.capacityMiddleService.middleBooking(id, false);

      console.timeEnd('middleBooking process...');

      console.log('---> pnmatchData : ', pnmatchData);
      console.log('---> setDataUse : ', setDataUse);
      // console.log('---> logWarnings : ', logWarnings);
      console.log('public date process...'); // 4468.201904296875 ms
      console.time('public date.');
      if (status_capacity_request_management_id === 2) {
        await this.capacityMiddleService.processGenPublicData(
          setDataUse,
          false,
        );
      }
      console.timeEnd('public date.');

      // -----

      console.log('create warning process...');
      console.time('create warning');
      if (logWarnings.length > 0) {
        await this.capacityMiddleService.capacityPublicationWarning(
          id,
          logWarnings,
          userId,
        );
      }
      console.timeEnd('create warning');

      console.log('path detail process...');
      console.time('path detail');
      if (
        status_capacity_request_management_id === 2 ||
        status_capacity_request_management_id === 4
      ) {
        await this.capacityMiddleService.genPathDetail(
          setDataUse,
          pnmatchData,
          id,
          userId,
        );
      }
      console.timeEnd('path detail');
    } else if (status_capacity_request_management_id === 5) {
      // terminate ------
      const contractCodePeriod = await this.prisma.contract_code.findFirst({
        where: { id: Number(id) },
        select: {
          shadow_period: true,
          status_capacity_request_management_id: true,
        },
      });
      console.log('terminate.........');
      console.log('id : ', id);
      console.log('contractCodePeriod?.status_capacity_request_management_id : ', contractCodePeriod?.status_capacity_request_management_id);
      if (contractCodePeriod?.status_capacity_request_management_id === 2) {
        // คืนค่าเก่า
        // terminate_date
        await this.restorePreviousVersion(id, terminate_date, userId);

        // คิดค่าใหม่
        const { pnmatchData, setDataUse, logWarnings, oldsetDataUse } =
          await this.capacityMiddleService.middleBooking(
            id,
            false,
            undefined,
            terminate_date,
          );

        console.log('public date process...');
        console.time('public date');
        // await this.capacityMiddleService.processGenPublicData(setDataUse, true);
        await this.capacityMiddleService.processGenPublicData(setDataUse, false);
        console.timeEnd('public date');

        console.log('path detail process...');
        console.time('path detail');
        await this.capacityMiddleService.genPathDetail(
          oldsetDataUse,
          pnmatchData,
          id,
          userId,
        );
        console.timeEnd('path detail');
      }

      // เคสที่ Terminated Contract แล้ว ไฟล์ Nom ที่ Submission เข้ามาก่อนหน้ายังไม่ถูก Cancelled
      await this.prisma.upload_template_for_shipper.updateMany({
        where: {
          contract_code_id: Number(id),
        },
        data: {
          del_flag: true,
        },
      });
      await this.prisma.query_shipper_nomination_file.updateMany({
        where: {
          contract_code_id: Number(id),
        },
        data: {
          query_shipper_nomination_status_id: 4,
          // del_flag: true,
        },
      });
    } else if (status_capacity_request_management_id === 3) {
      // reject ------
      const contractCodePeriod = await this.prisma.contract_code.findFirst({
        where: { id: Number(id) },
        select: {
          shadow_period: true,
          status_capacity_request_management_id: true,
        },
      });

      if (contractCodePeriod?.status_capacity_request_management_id === 2) {
        const { pnmatchData, setDataUse, logWarnings } =
          await this.capacityMiddleService.middleBooking(id, true);

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
            if (fCapacityPublication) {
              const dateMap = new Map();
              fCapacityPublication?.capacity_publication_date.forEach(
                (entry) => {
                  dateMap.set(
                    dayjs(entry.date_day).format('YYYY-MM-DD'),
                    entry,
                  );
                },
              );
              const batchUpdates = setDataUse[upi]?.resCalcNew[
                fCp
              ]?.calcNew.map((calc) => {
                const ckDateMatch = dateMap.get(
                  dayjs(calc.date).format('YYYY-MM-DD'),
                );

                if (ckDateMatch) {
                  let updateData = {};
                  let updateDataDC = {};
                  if (ckDateMatch?.value_adjust_use) {
                    updateData = {
                      value_adjust_use: String(calc.cals),
                    };
                    updateDataDC = {
                      ...ckDateMatch,
                      value_adjust_use: String(calc.cals),
                    };
                    // updateDataDC = {
                    //   ...ckDateMatch,
                    //   value_adjust_use: String(
                    //     setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                    //   ),
                    // };
                  } else if (ckDateMatch?.value_adjust) {
                    updateData = {
                      value_adjust_use: String(calc.cals),
                    };
                    updateDataDC = {
                      ...ckDateMatch,
                      value_adjust_use: String(calc.cals),
                    };
                    // updateDataDC = {
                    //   ...ckDateMatch,
                    //   value_adjust_use: String(
                    //     setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                    //   ),
                    // };
                  } else if (ckDateMatch?.value) {
                    updateData = {
                      value: String(calc.cals),
                    };
                    updateDataDC = {
                      ...ckDateMatch,
                      value: String(calc.cals),
                    };
                    // updateDataDC = {
                    //   value: String(
                    //     setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                    //   ),
                    // };
                  } else {
                    updateData = {
                      value: String(calc.cals),
                    };
                    updateDataDC = {
                      ...ckDateMatch,
                      value: String(calc.cals),
                    };
                    // updateDataDC = {
                    //   ...ckDateMatch,
                    //   value: String(
                    //     setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                    //   ),
                    // };
                  }
                  // const updateData = {
                  //   value_adjust_use: String(calc.cals),
                  // };
                  // return { where: { id: Number(ckDateMatch.id) }, data: updateData };
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
              });

              const updates = batchUpdates.filter((update) =>
                update.hasOwnProperty('where'),
              );
              const icpdData = batchUpdates.filter((insert) =>
                insert.hasOwnProperty('capacity_publication_id'),
              );

              // if (updates.length > 0) {
              //   await this.uploadDateCapacityDate(updates);
              //   // await this.prisma.$transaction(
              //   //   updates.map((update) =>
              //   //     this.prisma.capacity_publication_date.update(update),
              //   //   ),
              //   // );
              // }
              if (updates.length > 0) {
                // console.log('updates : ', updates);
                await this.prisma.capacity_publication_date.deleteMany({
                  where: {
                    id: {
                      in: updates.map((dc: any) => dc?.where?.id),
                    },
                  },
                });
                await this.prisma.capacity_publication_date.createMany({
                  data: updates?.map((cps: any) => cps?.data),
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

              await this.prisma.capacity_publication_date.createMany({
                data: icpdData,
              });
            }
          }
        }
      }

      await this.prisma.upload_template_for_shipper.updateMany({
        where: {
          contract_code_id: Number(id),
        },
        data: {
          del_flag: true,
        },
      });
      await this.prisma.query_shipper_nomination_file.updateMany({
        where: {
          contract_code_id: Number(id),
        },
        data: {
          query_shipper_nomination_status_id: 4,
          // del_flag: true,
        },
      });
    }

    console.log('process 3...');
    // terminate_date
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
        flag_use: true,
      },
      orderBy: {
        id: 'desc',
      },
      take: 1,
    });

    await this.prisma.booking_version.update({
      where: {
        id: Number(bookingVersionLast?.id),
        flag_use: true,
      },
      data: {
        status_capacity_request_management,
        submitted_timestamp: getTodayNowAdd7().toDate(),
        update_date: getTodayNowAdd7().toDate(),
        update_by_account: {
          connect: {
            id: Number(userId),
          },
        },
        update_date_num: getTodayNowAdd7().unix(),
      },
    });

    // nom
    if (status_capacity_request_management_id === 2) {
      const contract_code_id = Number(id);
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

      const dataFull = JSON.parse(getData['booking_full_json'][0]?.data_temp);
      const shipperName = dataFull?.shipperInfo[0]['Shipper Name'] || null;
      const getGroupByName =
        await this.capacityMiddleService.getGroupByName(shipperName);

      const daily = await this.uploadTemplateForShipperService.createTemplates(
        // grpcTransformDay,
        // { originalname: `${typeOfNominationDay}.xlsx` },
        null,
        null,
        {
          shipper_id: getGroupByName?.id,
          contract_code_id,
          nomination_type_id: 1,
          // comment: 'Auto-Generated',
          comment: 'Autogen', // https://app.clickup.com/t/86etzcgvx
        },
        userId,
        req,
      );

      const hisDaily = await this.uploadTemplateForShipperService.findOnce(
        daily?.id,
      );
      await this.uploadTemplateForShipperService.writeReq(
        req,
        `upload-template-for-shipper`,
        daily?.message, //create | edit
        hisDaily,
      );

      const weekly = await this.uploadTemplateForShipperService.createTemplates(
        // grpcTransformWeek,
        // { originalname: `${typeOfNominationWeek}.xlsx` },
        null,
        null,
        {
          shipper_id: getGroupByName?.id,
          contract_code_id,
          nomination_type_id: 2,
          // comment: 'Auto-Generated',
          comment: 'Autogen', // https://app.clickup.com/t/86etzcgvx
        },
        userId,
        req,
      );

      const hisWeekly = await this.uploadTemplateForShipperService.findOnce(
        weekly?.id,
      );
      await this.uploadTemplateForShipperService.writeReq(
        req,
        `upload-template-for-shipper`,
        weekly?.message, //create | edit
        hisWeekly,
      );
    }

    return resData;
  }

  async extendCapacityRequestManagementNotuse(
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
    jsonFull['data_temp'] = JSON.parse(jsonFull['data_temp']);

    let resultDate = null;
    let startDate = contract_start_date;
    const endDateDate = contract_end_date;
    let flagAmd = false;
    let contract_code: any = null;

    const nowDate = getTodayNowAdd7().toDate();
    const hasContractStarted =
      dayjs(nowDate).isAfter(dayjs(contractCode?.contract_start_date)) ||
      dayjs(nowDate).isSame(dayjs(contractCode?.contract_start_date));

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
    const npathManagementArr = pathManagementArr?.map((p: any) => {
      const { path_management_config, ...nP } = p;
      const npath_management_config = path_management_config.map((e: any) => {
        return {
          ...e,
          temps: JSON.parse(e['temps']),
        };
      });

      const npathConfig = npath_management_config.map((e: any) => {
        const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
          return f?.area?.entry_exit_id === 1;
        });

        const findExit = e?.temps?.revised_capacity_path?.map((f: any) => {
          return f;
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

    if (
      contractCode?.status_capacity_request_management_id === 2 &&
      hasContractStarted
    ) {
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
          // start_date: {
          //   lte: todayEnd,
          // },
          // end_date: {
          //   gte: todayStart,
          // },
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

      if(getTodayNowDDMMYYYYAdd7(contract_start_date).isSameOrAfter(getTodayNowDDMMYYYYAdd7(contract_end_date))) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: "The 'Period To' date must not be earlier than the 'Period From' date.",
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      let checkMinMax = false;
      // shadow_pe
      checkMinMax = this.capacityMiddleService.checkDateRange(
        contract_start_date,
        contract_end_date,
        bookingTemplate?.file_period_mode,
        bookingTemplate?.min,
        bookingTemplate?.max,
      );
      if (!checkMinMax) {
        console.log('1');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      contract_code = resultContractCode[0] + amdVersion;

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
              // id: 1,
              id: dayjs(contract_start_date, 'DD/MM/YYYY').isSameOrBefore(
                dayjs(),
                'day',
              )
                ? 1
                : 2,
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
          shadow_period: shadow_period || 0,
          shadow_time: shadow_time || 0,
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

      await this.prisma.contract_code.updateMany({
        where: {
          id: Number(contractCode?.id),
        },
        data: {
          contract_start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          contract_end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
        },
      });

      await this.prisma.extend_contract_capacity_request_management.create({
        data: {
          shadow_time: contractCode?.shadow_time || 0,
          shadow_period: contractCode?.shadow_period || 0,
          new_shadow_time: shadow_period || 0,
          new_shadow_period: shadow_period || 0,
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

      const keySDate = 7;
      const keyEDate = 7;

      if (bookingTemplate?.file_start_date_mode === 1) {
        resultDate = this.capacityMiddleService.generateDailyArray(
          startDate,
          endDateDate,
        );
      }

      if (bookingTemplate?.file_start_date_mode === 3) {
        startDate = dayjs(startDate, 'DD/MM/YYYY', true)
          .add(bookingTemplate?.todayday, 'day')
          .format('DD/MM/YYYY');
        resultDate = this.capacityMiddleService.generateDailyArray(
          startDate,
          endDateDate,
        );
      }

      if (bookingTemplate?.file_start_date_mode === 2) {
        startDate = this.capacityMiddleService.adjustStartDate(
          startDate,
          bookingTemplate?.fixdayday,
        );
        console.log('startDate : ', startDate);
        console.log('endDateDate : ', endDateDate);
        resultDate = this.capacityMiddleService.generateMonthArray(
          startDate,
          endDateDate,
          bookingTemplate?.fixdayday,
        );
        console.log('resultDate : ', resultDate);
        console.log('keySDate : ', keySDate);
      }

      // เรียง key ตามวันที่และเพิ่ม entry
      headerEntry['Capacity Daily Booking (MMBTU/d)'] =
        this.capacityMiddleService.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerEntry['Maximum Hour Booking (MMBTU/h)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length,
        );

      headerEntry['Capacity Daily Booking (MMscfd)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length * 2,
        );

      headerEntry['Maximum Hour Booking (MMscfh)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length * 3,
        );

      headerExit['Capacity Daily Booking (MMBTU/d)'] =
        this.capacityMiddleService.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerExit['Maximum Hour Booking (MMBTU/h)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length,
        );

      const newVEntry =
        await this.capacityMiddleService.transformToKeyArrayHValue(headerEntry);
      const newVExit =
        await this.capacityMiddleService.transformToKeyArrayHValue(headerExit);

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
          const valueNew = this.capacityMiddleService.mapKeyOldWithClosestValue(
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
          const valueNew = this.capacityMiddleService.mapKeyOldWithClosestValue(
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
      const sumEntries = this.capacityMiddleService.sumKeys(
        filteredDataEntry,
        Number(keySDate),
      );

      const sumEntsumExitsries = this.capacityMiddleService.sumKeys(
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
          contract_start_date: createContractCodeAmd?.contract_start_date,
          contract_end_date: createContractCodeAmd?.contract_end_date,
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

      const mapDataRowJson = [];
      for (let i = 0; i < newEntry.length; i++) {
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newExit[i]['0'];
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
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newExit[i]['0'];
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

      const contractCodeToGetEndDate =
        await this.prisma.contract_code.findFirst({
          where: {
            id: Number(id),
          },
        });
      const contractStartDate = getTodayNowDDMMYYYYDfaultAdd7(
        contractCodeToGetEndDate.contract_start_date,
      );
      const contractEndDate = getTodayNowDDMMYYYYDfaultAdd7(
        contractCodeToGetEndDate.contract_end_date,
      );
      const newTerminateDate = dayjs(nowDate);
      let terminateDate = dayjs(nowDate).format('YYYY-MM-DD');
      if (newTerminateDate.isBefore(contractStartDate, 'day')) {
        terminateDate = contractStartDate.format('YYYY-MM-DD');
      } else if (newTerminateDate.isAfter(contractEndDate, 'day')) {
        terminateDate = contractEndDate.format('YYYY-MM-DD');
      } else {
        terminateDate = newTerminateDate.format('YYYY-MM-DD');
      }

      try {
        //terminate เก่า
        await this.updateStatusCapacityRequestManagement(
          Number(id),
          {
            status_capacity_request_management_id: 5,

            terminate_date: terminateDate
              ? getTodayNowAdd7(terminateDate)
              : null,
          },
          userId,
          null,
        );
      } catch (error) {
        console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
      }

      try {
        await this.updateStatusCapacityRequestManagement(
          createContractCodeAmd?.id,
          {
            status_capacity_request_management_id: 2,
            terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
            ref_contract_code_by_main_id:
              contractCode?.ref_contract_code_by_main_id,
            ref_contract_code_by_id: contractCode?.id,
          },
          userId,
          null,
        );
      } catch (error) {
        console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
      }
    } else {
      console.log('else ......');
      flagAmd = false;
      contract_code = contractCode?.contract_code;
      const fCPn = await this.capacityMiddleService.capacityPublicationDateAll();
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
      const { bookingTemplate, modeDayAndMonth, file_period_mode } =
        await this.capacityMiddleService.bookingTemplate(
          Number(contractCode?.term_type_id),
        );

      if(getTodayNowDDMMYYYYAdd7(contract_start_date).isSameOrAfter(getTodayNowDDMMYYYYAdd7(contract_end_date))) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: "The 'Period To' date must not be earlier than the 'Period From' date.",
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      let checkMinMax = false;

      checkMinMax = this.capacityMiddleService.checkDateRange(
        contract_start_date,
        contract_end_date,
        bookingTemplate?.file_period_mode,
        bookingTemplate?.min,
        bookingTemplate?.max,
      );

      if (!checkMinMax) {
        console.log('checkMinMax Date is NOT match');
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
          shadow_time: contractCode?.shadow_time || 0,
          shadow_period: contractCode?.shadow_period || 0,
          new_shadow_time: (shadow_period && Number(shadow_period)) || 0,
          new_shadow_period: (shadow_period && Number(shadow_period)) || 0,
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

      const keySDate = 7;
      const keyEDate = 7;

      if (bookingTemplate?.term_type_id === 4) {
        startDate = dayjs(startDate, 'DD/MM/YYYY', true)
          .add(bookingTemplate?.todayday, 'day')
          .format('DD/MM/YYYY');
        resultDate = this.capacityMiddleService.generateDailyArray(
          startDate,
          endDateDate,
        );
      } else {
        resultDate = this.capacityMiddleService.generateMonthArray(
          startDate,
          endDateDate,
          1,
        );
      }

      // เรียง key ตามวันที่และเพิ่ม entry
      headerEntry['Capacity Daily Booking (MMBTU/d)'] =
        this.capacityMiddleService.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerEntry['Maximum Hour Booking (MMBTU/h)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length,
        );

      headerEntry['Capacity Daily Booking (MMscfd)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length * 2,
        );

      headerEntry['Maximum Hour Booking (MMscfh)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length * 3,
        );

      headerExit['Capacity Daily Booking (MMBTU/d)'] =
        this.capacityMiddleService.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerExit['Maximum Hour Booking (MMBTU/h)'] =
        this.capacityMiddleService.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length,
        );

      const newVEntry =
        await this.capacityMiddleService.transformToKeyArrayHValue(headerEntry);
      const newVExit =
        await this.capacityMiddleService.transformToKeyArrayHValue(headerExit);

      console.log('+++ newVEntry : ', newVEntry);
      console.log(
        `---- jsonFull['data_temp']['entryValue']`,
        jsonFull['data_temp']['entryValue'],
      );

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
          // console.log('rowValueOld : ', rowValueOld);
          // const valueNew = this.capacityMiddleService.mapKeyOldWithClosestValueNew(
          // const valueNew = this.capacityMiddleService.mapKeyOldWithClosestValue(
          const valueNew =
            this.capacityMiddleService.mapKeyOldWithClosestValueNew(
              newVEntry,
              jsonFull['data_temp']['headerEntry'],
              rowValueOld,
              // contract_start_date,
              // contract_end_date,
              // entry,
            );
          console.log('valueNew : ', valueNew);

          // rowOld['34'] = contract_end_date;
          rowOld['5'] = contract_start_date;
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
          // const valueNew = this.capacityMiddleService.mapKeyOldWithClosestValueNew(
          const valueNew = this.capacityMiddleService.mapKeyOldWithClosestValue(
            newVExit,
            jsonFull['data_temp']['headerExit'],
            rowValueOld,
            // contract_start_date,
            // contract_end_date,
            // exit,
          );
          // rowOld['34'] = contract_end_date;
          rowOld['5'] = contract_start_date;
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

      console.log('headerEntry : ', headerEntry);
      console.log('headerExit : ', headerExit);

      data_temp['shipperInfo'] = jsonFull['data_temp']['shipperInfo'];
      data_temp['headerEntry'] = headerEntry;
      data_temp['headerExit'] = headerExit;
      data_temp['entryValue'] = filteredDataEntry;
      data_temp['exitValue'] = filteredDataExit;
      const sumEntries = this.capacityMiddleService.sumKeys(
        filteredDataEntry,
        Number(keySDate),
      );

      const sumEntsumExitsries = this.capacityMiddleService.sumKeys(
        filteredDataExit,
        Number(keyEDate),
      );

      console.log('filteredDataEntry : ', filteredDataEntry);
      console.log('keySDate : ', keySDate);
      console.log('- - - -');
      console.log('filteredDataExit : ', filteredDataExit);
      console.log('keyEDate : ', keyEDate);
      console.log('- - - -');
      console.log('sumEntries : ', sumEntries);
      console.log('sumEntsumExitsries : ', sumEntsumExitsries);

      data_temp['sumEntries'] = { '0': 'Sum Entry', ...sumEntries };
      data_temp['sumExits'] = { '0': 'Sum Exit', ...sumEntsumExitsries };

      const newEntry = data_temp['entryValue'];
      const newExit = data_temp['exitValue'];

      console.log('-newEntry : ', newEntry);
      console.log('-newExit : ', newExit);

      // เพิ่ม version ------------------------------------------

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
          contract_start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          contract_end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
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
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newEntry[i]['0'];
        });

        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 1,

          zone_text: contractPoint?.zone?.name,
          area_text: contractPoint?.area?.name,
          contract_point: newEntry[i]['0'],
          flag_use: true,
          data_temp: JSON.stringify(newEntry[i]),
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      for (let i = 0; i < newExit.length; i++) {
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newExit[i]['0'];
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

      console.log('mapDataRowJson : ', mapDataRowJson);

      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });

      await this.prisma.contract_code.updateMany({
        where: {
          id: Number(contractCode?.id),
        },
        data: {
          contract_start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          contract_end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
        },
      });

      // ปรับใหม่ ------------------------------------------
      // valueExtend

      console.log('คืนค่าเก่า');
      await this.restorePreviousVersion(id);

      const { pnmatchData, setDataUse, logWarnings } =
        await this.capacityMiddleService.middleBooking(id, false);

      console.log('path detail process...');
      console.time('path detail');
      await this.capacityMiddleService.genPathDetail(
        setDataUse,
        pnmatchData,
        id,
        userId,
      );
      console.timeEnd('path detail');
    }

    return {
      message: 'Success',
    };
  }

  makeFillWithLast(arr: string[], count: number) {
      const last = arr.length ? arr[arr.length - 1] : "0";
      return Array.from({ length: count }, () => last);
  };

   makeFillWithFirst(arr: string[], count: number) {
      const first = arr.length ? arr[0] : "0";
      return Array.from({ length: count }, () => first);
  };



  trimRowByHeaderChange = (
    oldHeaders: string[],
    newHeaders: string[],
    mode: 'FROM' | 'TO',
    data: any[],
    entryExit: number
) => {

    function chunkIntoParts<T>(xs: T[], parts: number): T[][] {
      const size = Math.ceil(xs.length / parts);
      return Array.from({ length: parts }, (_, i) => xs.slice(i * size, (i + 1) * size));
    }


    const groups = entryExit === 1 ? 4 : 2;
    // const out = chunkIntoParts(data, 4)

    const oldLength = oldHeaders.length;
    const newLength = newHeaders.length;
    const diff = oldLength - newLength;

    if (diff <= 0) return data; // no trimming needed
    
    const totalKeysToRemove = diff * groups;
    
    return data.map((row) => {
        const newRow: any = {};
        // copy keys 0–6
        for (let i = 0; i <= 6; i++) {
            newRow[i] = row[i];
        }

        // collect value blocks (grouped)
        let values: string[] = [];
        const valueStart = 7;
        let keyIndex = valueStart;
        while (row[keyIndex] !== undefined) {
            values.push(row[keyIndex]);
            keyIndex++;
        }
        
        if (mode === 'FROM') {
          const cutValues = chunkIntoParts(values, groups)
          const baseCut = Math.floor(totalKeysToRemove / groups);
          const extra = totalKeysToRemove % groups; // ส่วนเกินแจกให้ก้อนแรกๆ ทีละ 1
            const ncutValues = cutValues.map((chunk, i) => {
              const cut = baseCut + (i < extra ? 1 : 0); // กระจายส่วนเกิน
              return chunk.slice(cut); // ใช้ slice เพื่อไม่ mutate ต้นฉบับ
            });
            values = ncutValues?.flat()
        } else {
          const cutValues = chunkIntoParts(values, groups)
          const baseCut = Math.floor(totalKeysToRemove / groups);
          const extra = totalKeysToRemove % groups; 
          const ncutValues = cutValues.map((chunk, i) => {
            const cut = Math.min(chunk.length, baseCut + (i < extra ? 1 : 0)); // จำนวนที่จะตัดจากท้าย
            const keepLen = Math.max(0, chunk.length - cut);                   // ความยาวที่เหลือ
            return chunk.slice(0, keepLen);                                    // ← ตัดท้าย
          });
            values = ncutValues?.flat()
        }

        // assign trimmed values back to keys 7+
        values.forEach((val, i) => {
            newRow[i + 7] = val;
        });

        return newRow;
    });
};

 getMonthCountDiff = (newHeaders: string[], oldHeaders: string[], direction: 'FROM' | 'TO') => {

    // return Math.abs(newHeaders.length - oldHeaders?.length)
    let count = 0;

    if (direction === 'FROM') {
        for (const date of newHeaders) {
            if (!oldHeaders.includes(date)) count++;
            else break;
        }
    } else {
        // นับเฉพาะค่าที่ "อยู่ใน newHeaders แต่ไม่อยู่ใน oldHeaders"
        const addedFromEnd = newHeaders.filter(h => !oldHeaders.includes(h));
        count = addedFromEnd.length;

    }

    return count;
};

  updateRow(mode: 'FROM' | 'TO', new_header: any, old_header: any, example_data: any, entryExit:number) {
      if (mode !== 'FROM' && mode !== 'TO') return;

      // console.log('mode', mode)
      // console.log('new_header', new_header)
      // console.log('old_header', old_header)
      // console.log('example_data', example_data)

      // mode: 'FROM' | 'TO' คือแก้วันที่ FROM หรือ TO

      // let new_header = [
      //     "01/08/2025",
      //     "01/09/2025",
      //     "01/10/2025",
      //     "01/11/2025",
      //     "01/12/2025"
      // ]

      // let old_header = [
      //     "01/09/2025",
      //     "01/10/2025",
      //     "01/11/2025",
      //     "01/12/2025"
      // ]

      // let example_data = [
      //     {
      //         "0": "ENTRY-X3-EGAT",
      //         "1": " ",
      //         "3": " ",
      //         "5": "01/08/2025",
      //         "6": "25/12/2025",
      //         "7": "151000.000",
      //         "8": "150000",
      //         "9": "120000",
      //         "10": "120000",
      //         "11": "6250",
      //         "12": "6250",
      //         "13": "5000",
      //         "14": "5000",
      //         "15": "150",
      //         "16": "150",
      //         "17": "120",
      //         "18": "120",
      //         "19": "6.25",
      //         "20": "6.25",
      //         "21": "5",
      //         "22": "5"
      //     }
      // ]

      const newHeaders = new_header;
      const oldHeaders = old_header;

      // oldHeaders = [ "01/05/2025", "01/06/2025", "01/07/2025","01/08/2025"]
      // newHeaders = ["01/07/2025", "01/08/2025"]
      // ถ้า newHeaders มีน้อยกว่า oldHeaders ให้ลบ ข้อมูลตาม example_data ไปด้วย

      const addedMonths = this.getMonthCountDiff(newHeaders, oldHeaders, mode);

      // console.log('addedMonths', addedMonths)
      // const example_data = [
      //     {
      //         "0": "Entry-X1-PTT",
      //         "1": "900",
      //         "2": "1000",
      //         "3": "85",
      //         "4": "90",
      //         "5": "10/06/2025",
      //         "6": "03/10/2025",

      //         "7": "15000",
      //         "8": "10000",
      //         "9": "10000",
      //         "10": "10000",

      //         "11": "625",
      //         "12": "416.667",
      //         "13": "416.667",
      //         "14": "416.667",

      //         "15": "15",
      //         "16": "10",
      //         "17": "10",
      //         "18": "10",

      //         "19": "0.625",
      //         "20": "0.417",
      //         "21": "0.417",
      //         "22": "0.417"
      //     },
      //     {
      //         "0": "Entry-Y-PTT",
      //         "1": "900",
      //         "2": "1000",
      //         "3": "85",
      //         "4": "90",
      //         "5": "30/05/2025",
      //         "6": "30/08/2025",

      //         "7": "0",
      //         "8": "5000",
      //         "9": "5000",
      //         "10": "5000",

      //         "11": "0",
      //         "12": "208.333",
      //         "13": "208.333",
      //         "14": "208.333",

      //         "15": "0",
      //         "16": "5",
      //         "17": "5",
      //         "18": "5",

      //         "19": "0",
      //         "20": "0.208",
      //         "21": "0.208",
      //         "22": "0.208"
      //     }
      // ]

      // if (addedMonths === 0) return;
      if (addedMonths === 0) {
          // case นี้คือลดช่วงเวลา period from, to
          const updatedExampleData = this.trimRowByHeaderChange(
              oldHeaders,
              newHeaders,
              mode, // 'FROM' หรือ 'TO'
              example_data,
              entryExit
          );
          console.log('n oldHeaders : ', oldHeaders);
          console.log('n newHeaders : ', newHeaders);
          console.log('n example_data : ', example_data);

          console.log('✅ updatedExampleData ----->', updatedExampleData)
          return updatedExampleData
      } else {
          // case นี้เพิ่มช่วงเวลา period from, to

          const groups = entryExit === 1 ? 4 : 2;
          const keysPerGroup = oldHeaders.length;
          const newKeysPerGroup = newHeaders.length;
          const keysToAddPerGroup = newKeysPerGroup - keysPerGroup;

          // เติม 0 ลงคีย์ใหม่
          // const updatedData = example_data.map((row: any) => {
          //     const newRow: any = {};

          //     // คัดลอก key 0-6
          //     for (let i = 0; i <= 6; i++) {
          //         newRow[i] = row[i];
          //     }

          //     // จัดกลุ่มข้อมูล 4 กลุ่ม
          //     const groupData: string[][] = Array.from({ length: groups }, () => []);
          //     let baseKey = 7;
          //     for (let g = 0; g < groups; g++) {
          //         for (let i = 0; i < keysPerGroup; i++) {
          //             const key = String(baseKey++);
          //             groupData[g].push(row[key] ?? "0");
          //         }
          //     }

          //     if (mode === 'FROM') {
          //         // เพิ่ม "0" ด้านหน้าแต่ละกลุ่ม
          //         for (let g = 0; g < groups; g++) {
          //             const zeros = Array(keysToAddPerGroup).fill("0");
          //             groupData[g] = [...zeros, ...groupData[g]];
          //         }
          //     } else if (mode === 'TO') {
          //         // เพิ่ม "0" ด้านหลังแต่ละกลุ่ม
          //         for (let g = 0; g < groups; g++) {
          //             const zeros = Array(keysToAddPerGroup).fill("0");
          //             groupData[g] = [...groupData[g], ...zeros];
          //         }
          //     }

          //     // แปลงกลับเป็น flat key/value
          //     let newKeyIndex = 7;
          //     for (const group of groupData) {
          //         for (const val of group) {
          //             newRow[newKeyIndex++] = val;
          //         }
          //     }

          //     return newRow;
          // });

          // เติมค่าสุดท้ายของ row ลงคีย์ใหม่
          const updatedData = example_data.map((row: any) => {
              const newRow: any = {};

              // คัดลอก key 0-6
              for (let i = 0; i <= 6; i++) {
                  newRow[i] = row[i];
              }

              // ดึงข้อมูลเป็น 4 กลุ่ม
              const groupData: string[][] = Array.from({ length: groups }, () => []);
              let baseKey = 7;
              for (let g = 0; g < groups; g++) {
                  for (let i = 0; i < keysPerGroup; i++) {
                      const key = String(baseKey++);
                      groupData[g].push(row[key] ?? "0");
                  }
              }

              // const groupData: string[][] = Array.from({ length: groups }, (_, g) =>
              //     Array.from({ length: keysPerGroup }, (_, i) => {
              //       const key = String(baseKey + g * keysPerGroup + i);
              //       return row[key] ?? '0';
              //     })
              //   );
              console.log('-- groupData : ', groupData);


              if (mode === 'FROM') {
                  // เติมค่าตัวสุดท้ายไว้ "ด้านหน้า" ของแต่ละกลุ่ม
                  for (let g = 0; g < groups; g++) {
                      const fill = this.makeFillWithFirst(groupData[g], keysToAddPerGroup); // เอาค่าของตัวแรกมาใส่ ที่จะย้อนหลังวัน
                      groupData[g] = [...fill, ...groupData[g]];
                  }
              } else if (mode === 'TO') {
                  // เติมค่าตัวสุดท้ายไว้ "ด้านหลัง" ของแต่ละกลุ่ม
                  for (let g = 0; g < groups; g++) {
                      const fill = this.makeFillWithLast(groupData[g], keysToAddPerGroup); // เอาค่าของตัวสุดท้ายมาใส่ ที่จะเพิ่มวัน
                      groupData[g] = [...groupData[g], ...fill];
                  }
              }

              // แปลงกลับเป็น flat key/value
              let newKeyIndex = 7;
              for (const group of groupData) {
                  for (const val of group) {
                      newRow[newKeyIndex++] = val;
                  }
              }

              return newRow;
          });

          // console.log("✅ Updated Data:", updatedData);
          return updatedData
      }

    };

  async fnExtendDateJSONNew(payload:any){
    const {
        bookingTemplate,
        jsonFull,
        new_contract_start_date,
        new_contract_end_date,
        startDate,
        endDateDate,
      } = payload
      console.log('...fnExtendDateJSONNew');
      let oresultDate = []
      let nresultDateStep1 = []
      let nresultDate = []
      let ostartDate = null
      let nstartDateStep1 = null
      let nstartDate = null
      if (bookingTemplate?.term_type_id === 4) {
        ostartDate = dayjs(startDate, 'DD/MM/YYYY', true)
          .add(bookingTemplate?.todayday, 'day')
          .format('DD/MM/YYYY');
        oresultDate = this.capacityMiddleService.generateDailyArray(
          startDate,
          endDateDate,
        );
        // 
        nstartDateStep1 = dayjs(new_contract_start_date, 'DD/MM/YYYY', true)
          .add(bookingTemplate?.todayday, 'day')
          .format('DD/MM/YYYY');
        nresultDateStep1 = this.capacityMiddleService.generateDailyArray(
          new_contract_start_date,
          endDateDate,
        );
        // 
        nstartDate = dayjs(new_contract_start_date, 'DD/MM/YYYY', true)
          .add(bookingTemplate?.todayday, 'day')
          .format('DD/MM/YYYY');
        nresultDate = this.capacityMiddleService.generateDailyArray(
          new_contract_start_date,
          new_contract_end_date,
        );
      } else {
        ostartDate = startDate
        oresultDate = this.capacityMiddleService.generateMonthArray(
          startDate,
          endDateDate,
          1,
        );
        // 
        nstartDateStep1 = new_contract_start_date
        nresultDateStep1 = this.capacityMiddleService.generateMonthArray(
          new_contract_start_date,
          endDateDate,
          1,
        );
        // 
        nstartDate = new_contract_start_date
        nresultDate = this.capacityMiddleService.generateMonthArray(
          new_contract_start_date,
          new_contract_end_date,
          1,
        );
      }

      // console.log('startDate : ', startDate);
      // console.log('endDateDate : ', endDateDate);
      // console.log('oresultDate : ', oresultDate);
      // console.log('nresultDate : ', nresultDate);

      // oldHeaders = [ "01/05/2025", "01/06/2025", "01/07/2025","01/08/2025"]
      // newHeaders = ["01/07/2025", "01/08/2025"]
      const oldHeaders = oresultDate
      const newHeadersStep1 = nresultDateStep1
      const newHeaders = nresultDate
      // console.log('oldHeaders : ', oldHeaders);
      // console.log('newHeadersStep1 : ', newHeadersStep1);
      // console.log('newHeaders : ', newHeaders);
      const entryOld = jsonFull?.data_temp?.entryValue
      const exitOld = jsonFull?.data_temp?.exitValue
      const updateRowEntryFROM = this.updateRow("FROM",newHeadersStep1, oldHeaders, entryOld, 1)
      const updateRowEntryTO = this.updateRow("TO",newHeaders, newHeadersStep1, updateRowEntryFROM, 1)
      const updateRowExitFROM = this.updateRow("FROM",newHeadersStep1, oldHeaders, exitOld, 2)
      const updateRowExitTO = this.updateRow("TO",newHeaders, newHeadersStep1, updateRowExitFROM, 2)

      function datesToIndexedObject(dates: string[], start:number) {
        // เรียงวันที่จากน้อยไปมาก
        const sorted = [...dates].sort((a, b) => {
          const [da, ma, ya] = a.split('/').map(Number);
          const [db, mb, yb] = b.split('/').map(Number);
          // สร้างเป็น time value เพื่อเทียบ
          return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
        });

        // แปลงเป็น object โดย key เริ่มที่ 1
        const out: any = {};
        sorted.forEach((d, i) => (out[d] = {key: String(i + start)}));
        out.key = String(start)
        return out;
      }

      // ปรับวัน updateRowEntryTO, updateRowExitTO
      const entryValue = updateRowEntryTO?.map((e:any) => {
          e["5"] = new_contract_start_date
          e["6"] = new_contract_end_date
          return {
            ...e,
          }
        })
      const exitValue = updateRowExitTO?.map((e:any) => {
          e["5"] = new_contract_start_date
          e["6"] = new_contract_end_date
          return {
            ...e,
          }
        })
     
      const data_temp = {
        shipperInfo: jsonFull?.data_temp?.shipperInfo,
        headerEntry:{
          ["Entry"]: jsonFull?.data_temp?.headerEntry?.["Entry"],
          ["Period"]: jsonFull?.data_temp?.headerEntry?.["Period"],
          ["Capacity Daily Booking (MMBTU/d)"]: datesToIndexedObject(newHeaders, 7), // เสร็จ
          ["Maximum Hour Booking (MMBTU/h)"]: datesToIndexedObject(newHeaders, 7 + newHeaders?.length), // เสร็จ
          ["Capacity Daily Booking (MMscfd)"]: datesToIndexedObject(newHeaders, 7 + (newHeaders?.length * 2)), // เสร็จ
          ["Maximum Hour Booking (MMscfh)"]: datesToIndexedObject(newHeaders, 7 + (newHeaders?.length * 3)), // เสร็จ
        },
        headerExit:{
          ["Exit"]: jsonFull?.data_temp?.headerExit?.["Exit"],
          ["Period"]: jsonFull?.data_temp?.headerExit?.["Period"],
          ["Capacity Daily Booking (MMBTU/d)"]: datesToIndexedObject(newHeaders, 7), // เสร็จ
          ["Maximum Hour Booking (MMBTU/h)"]: datesToIndexedObject(newHeaders, 7 + newHeaders?.length), // เสร็จ
        },
        entryValue: entryValue, // เสร็จ
        exitValue: exitValue, // เสร็จ
        sumEntries: { '0': 'Sum Entry', ...this.capacityMiddleService.sumKeys(
          entryValue,
          7,
        )}, // เสร็จ
        sumExits: { '0': 'Sum Exit', ...this.capacityMiddleService.sumKeys(
          exitValue,
          7,
        )}, // เสร็จ
      }

    return {
      nstartDate,
      nresultDate,
      new_data_temp: data_temp,
    }
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
    jsonFull['data_temp'] = JSON.parse(jsonFull['data_temp']);

    let resultDate = null;
    let startDate = contract_start_date;
    const endDateDate = contract_end_date;
    let flagAmd = false;
    let contract_code: any = null;

    const nowDate = getTodayNowAdd7().toDate();
    const hasContractStarted =
      dayjs(nowDate).isAfter(dayjs(contractCode?.contract_start_date)) ||
      dayjs(nowDate).isSame(dayjs(contractCode?.contract_start_date));

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
    const npathManagementArr = pathManagementArr?.map((p: any) => {
      const { path_management_config, ...nP } = p;
      const npath_management_config = path_management_config.map((e: any) => {
        return {
          ...e,
          temps: JSON.parse(e['temps']),
        };
      });

      const npathConfig = npath_management_config.map((e: any) => {
        const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
          return f?.area?.entry_exit_id === 1;
        });

        const findExit = e?.temps?.revised_capacity_path?.map((f: any) => {
          return f;
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

    if (
      contractCode?.status_capacity_request_management_id === 2 &&
      hasContractStarted
    ) {
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
          // start_date: {
          //   lte: todayEnd,
          // },
          // end_date: {
          //   gte: todayStart,
          // },
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

      if(getTodayNowDDMMYYYYAdd7(contract_start_date).isSameOrAfter(getTodayNowDDMMYYYYAdd7(contract_end_date))) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: "The 'Period To' date must not be earlier than the 'Period From' date.",
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      let checkMinMax = false;
      // shadow_pe
      checkMinMax = this.capacityMiddleService.checkDateRange(
        contract_start_date,
        contract_end_date,
        bookingTemplate?.file_period_mode,
        bookingTemplate?.min,
        bookingTemplate?.max,
      );
      if (!checkMinMax) {
        console.log('1');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      contract_code = resultContractCode[0] + amdVersion;

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
              // id: 1,
              id: dayjs(contract_start_date, 'DD/MM/YYYY').isSameOrBefore(
                dayjs(),
                'day',
              )
                ? 1
                : 2,
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
          shadow_period: shadow_period || 0,
          shadow_time: shadow_time || 0,
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

      await this.prisma.contract_code.updateMany({
        where: {
          id: Number(contractCode?.id),
        },
        data: {
          contract_start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          contract_end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
        },
      });

      // old ไม่ใช้
      // const keySDate = 7;
      // const keyEDate = 7;
      // if (bookingTemplate?.file_start_date_mode === 1) {
      //   resultDate = this.capacityMiddleService.generateDailyArray(
      //     startDate,
      //     endDateDate,
      //   );
      // }

      // if (bookingTemplate?.file_start_date_mode === 3) {
      //   startDate = dayjs(startDate, 'DD/MM/YYYY', true)
      //     .add(bookingTemplate?.todayday, 'day')
      //     .format('DD/MM/YYYY');
      //   resultDate = this.capacityMiddleService.generateDailyArray(
      //     startDate,
      //     endDateDate,
      //   );
      // }

      // if (bookingTemplate?.file_start_date_mode === 2) {
      //   startDate = this.capacityMiddleService.adjustStartDate(
      //     startDate,
      //     bookingTemplate?.fixdayday,
      //   );
      //   resultDate = this.capacityMiddleService.generateMonthArray(
      //     startDate,
      //     endDateDate,
      //     bookingTemplate?.fixdayday,
      //   );
      // }

       const fnExtendDateJSONNew = await this.fnExtendDateJSONNew({
        bookingTemplate: bookingTemplate,
        jsonFull: jsonFull,
        new_contract_start_date: contract_start_date,
        new_contract_end_date: contract_end_date,
        startDate: dayjs(contractCode?.contract_start_date).format("DD/MM/YYYY"),
        endDateDate: dayjs(contractCode?.contract_end_date).format("DD/MM/YYYY"),
      })
      startDate = fnExtendDateJSONNew?.nstartDate
      resultDate = fnExtendDateJSONNew?.nresultDate

      const data_temp: any = fnExtendDateJSONNew?.new_data_temp;

      const newEntry = data_temp['entryValue'];
      const newExit = data_temp['exitValue'];

      await this.prisma.extend_contract_capacity_request_management.create({
        data: {
          shadow_time: contractCode?.shadow_time || 0,
          shadow_period: contractCode?.shadow_period || 0,
          new_shadow_time: shadow_period || 0,
          new_shadow_period: shadow_period || 0,
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
          contract_start_date: createContractCodeAmd?.contract_start_date,
          contract_end_date: createContractCodeAmd?.contract_end_date,
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

      const mapDataRowJson = [];
      for (let i = 0; i < newEntry.length; i++) {
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newExit[i]['0'];
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
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newExit[i]['0'];
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

      const contractCodeToGetEndDate =
        await this.prisma.contract_code.findFirst({
          where: {
            id: Number(id),
          },
        });
      const contractStartDate = getTodayNowDDMMYYYYDfaultAdd7(
        contractCodeToGetEndDate.contract_start_date,
      );
      const contractEndDate = getTodayNowDDMMYYYYDfaultAdd7(
        contractCodeToGetEndDate.contract_end_date,
      );
      const newTerminateDate = dayjs(nowDate);
      let terminateDate = dayjs(nowDate).format('YYYY-MM-DD');
      if (newTerminateDate.isBefore(contractStartDate, 'day')) {
        terminateDate = contractStartDate.format('YYYY-MM-DD');
      } else if (newTerminateDate.isAfter(contractEndDate, 'day')) {
        terminateDate = contractEndDate.format('YYYY-MM-DD');
      } else {
        terminateDate = newTerminateDate.format('YYYY-MM-DD');
      }

      try {
        //terminate เก่า
        await this.updateStatusCapacityRequestManagement(
          Number(id),
          {
            status_capacity_request_management_id: 5,

            terminate_date: terminateDate
              ? getTodayNowAdd7(terminateDate)
              : null,
          },
          userId,
          null,
        );
      } catch (error) {
        console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
      }

      try {
        await this.updateStatusCapacityRequestManagement(
          createContractCodeAmd?.id,
          {
            status_capacity_request_management_id: 2,
            terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
            ref_contract_code_by_main_id:
              contractCode?.ref_contract_code_by_main_id,
            ref_contract_code_by_id: contractCode?.id,
          },
          userId,
          null,
        );
      } catch (error) {
        console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
      }
    } else {
      console.log('version extend');
      flagAmd = false;
      contract_code = contractCode?.contract_code;
      if(contractCode.status_capacity_request_management_id === 2){
        await this.restorePreviousVersion(id);
      }
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
      const { bookingTemplate, modeDayAndMonth, file_period_mode } =
        await this.capacityMiddleService.bookingTemplate(
          Number(contractCode?.term_type_id),
        );

      if(getTodayNowDDMMYYYYAdd7(contract_start_date).isSameOrAfter(getTodayNowDDMMYYYYAdd7(contract_end_date))) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: "The 'Period To' date must not be earlier than the 'Period From' date.",
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      let checkMinMax = false;

      checkMinMax = this.capacityMiddleService.checkDateRange(
        contract_start_date,
        contract_end_date,
        bookingTemplate?.file_period_mode,
        bookingTemplate?.min,
        bookingTemplate?.max,
      );

      if (!checkMinMax) {
        console.log('checkMinMax Date is NOT match');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const fnExtendDateJSONNew = await this.fnExtendDateJSONNew({
        bookingTemplate: bookingTemplate,
        jsonFull: jsonFull,
        new_contract_start_date: contract_start_date,
        new_contract_end_date: contract_end_date,
        startDate: dayjs(contractCode?.contract_start_date).format("DD/MM/YYYY"),
        endDateDate: dayjs(contractCode?.contract_end_date).format("DD/MM/YYYY"),
      })
      startDate = fnExtendDateJSONNew?.nstartDate
      resultDate = fnExtendDateJSONNew?.nresultDate
      // fnExtendDateJSONNew?.new_data_temp

      // return fnExtendDateJSONNew

      await this.prisma.extend_contract_capacity_request_management.create({
        data: {
          shadow_time: contractCode?.shadow_time || 0,
          shadow_period: contractCode?.shadow_period || 0,
          new_shadow_time: shadow_period || 0,
          new_shadow_period: shadow_period || 0,
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

      const data_temp: any = fnExtendDateJSONNew?.new_data_temp;

      const newEntry = data_temp['entryValue'];
      const newExit = data_temp['exitValue'];

      console.log('data_temp : ', data_temp);
      console.log('newEntry : ', newEntry);
      console.log('newExit : ', newExit);

      // เพิ่ม version ------------------------------------------

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
          contract_start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          contract_end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
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
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newExit[i]['0'];
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
        const contractPoint = contractPointAPI.find((fNe: any) => {
          return fNe?.contract_point === newExit[i]['0'];
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

      await this.prisma.contract_code.updateMany({
        where: {
          id: Number(contractCode?.id),
        },
        data: {
          contract_start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          contract_end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
        },
      });

      // extend_deadline

      // ปรับใหม่ ------------------------------------------
      // valueExtend

      if (contractCode?.status_capacity_request_management_id === 2) {
      const { pnmatchData, setDataUse, logWarnings } =
        await this.capacityMiddleService.middleBooking(id, false);

        await this.capacityMiddleService.processGenPublicData(
          setDataUse,
          false,
        );
        
        console.log('path detail process...');
        console.time('path detail');
        await this.capacityMiddleService.genPathDetail(
          setDataUse,
          pnmatchData,
          id,
          userId,
        );
        console.timeEnd('path detail');
      }
    }

    return {
      message: 'Success',
    };
  }

  async editVersion(payload: any, id: any, userId: any) {
    const {
      flagFromTo,
      booking_full_json,
      booking_row_json,
      terminateDate,
      fromDate,
      toDate,
    } = payload;
    const bookingVersion = await this.prisma.booking_version.findFirst({
      where: {
        id: Number(id),
      },
      include: {
        contract_code: true,
        booking_full_json: true,
        booking_row_json: true,
      },
    });

    const startDate = bookingVersion?.contract_code?.contract_start_date;
    const status =
      bookingVersion?.contract_code?.status_capacity_request_management_id;

    const nowDate = getTodayNowAdd7().toDate();

    const hasContractStarted =
      getTodayNowAdd7(nowDate).isAfter(getTodayNowAdd7(startDate)) ||
      getTodayNowAdd7(nowDate).isSame(getTodayNowAdd7(startDate));

    const modeDayAndMonth =
      bookingVersion?.contract_code?.term_type_id === 4 ? 1 : 2;
    const shadowPeriod = this.capacityMiddleService.genMD(
      fromDate,
      getTodayNowDDMMYYYYDfaultAdd7(toDate)
        .subtract(1, 'day')
        .format('DD/MM/YYYY'),
      modeDayAndMonth,
    );

    const newEntry = booking_row_json.filter((f: any) => {
      return f?.entry_exit_id === 1;
    });

    const newExit = booking_row_json.filter((f: any) => {
      return f?.entry_exit_id === 2;
    });

    // area_text

    // https://app.clickup.com/t/86erqt8g5
    const ckAreaDup = [...newEntry, ...newExit]?.map(
      (ar: any) => ar?.area_text,
    );
    console.log('ckAreaDup : ', ckAreaDup);
    const hasDuplicate = new Set(ckAreaDup).size !== ckAreaDup.length;
    // console.log('- ckAreaDup : ', ckAreaDup);
    if (hasDuplicate) {
      // console.log('ckAreaDup : ', ckAreaDup);
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Duplicate Contract Point found.',
          // error: 'Area is Contract Point Duplicate.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (status === 2 && hasContractStarted) {
      let contract_code: any = null;
      let amdVersion: any = null;
      // amd
      console.log('amd');
      const contractCode = await this.prisma.contract_code.findFirst({
        where: {
          id: bookingVersion?.contract_code?.ref_contract_code_by_main_id,
        },
        select: { contract_code: true },
      });
      const checkContractCodeCheckLength =
        await this.prisma.contract_code.count({
          where: {
            ref_contract_code_by_main_id: bookingVersion?.contract_code?.ref_contract_code_by_main_id,
          },
        });
      amdVersion =
        '_Amd' +
        String(
          checkContractCodeCheckLength > 9
            ? checkContractCodeCheckLength
            : '0' + checkContractCodeCheckLength,
        );
      contract_code = contractCode?.contract_code + amdVersion;

      const oldStatusID = bookingVersion?.contract_code?.status_capacity_request_management_id
      let statusCapacityRequestManagementProcessID = 1 // Active
      switch(oldStatusID){
        case 1: // Saved
        case 4: // Confirmed
          statusCapacityRequestManagementProcessID = 3; // Waiting For Approval
          break;
        case 3: // Rejected
        case 5: // Terminated
          statusCapacityRequestManagementProcessID = 5; //Close
          break;
        default: // Approved
          if(fromDate){
            const today = getTodayStartAdd7()
            const contractStartDate = getTodayStartDDMMYYYYAdd7(fromDate)
            if(contractStartDate.isAfter(today)){
              statusCapacityRequestManagementProcessID = 2; // Waiting For Start Date
            }else{
              statusCapacityRequestManagementProcessID = 1; // Active
            }
          }
          else{
            statusCapacityRequestManagementProcessID = 2; // Waiting For Start Date
          }
          break;
      }

      const createContractCodeAmd = await this.prisma.contract_code.create({
        data: {
          contract_code: contract_code,
          ...(!!bookingVersion?.contract_code?.term_type_id && {
            term_type: {
              connect: {
                id: bookingVersion?.contract_code?.term_type_id,
              },
            },
          }),
          ...(!!bookingVersion?.contract_code?.group_id && {
            group: {
              connect: {
                id: bookingVersion?.contract_code?.group_id,
              },
            },
          }),
          status_capacity_request_management_process: {
            connect: {
              id: statusCapacityRequestManagementProcessID,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: oldStatusID,
            },
          },
          type_account: {
            connect: {
              id: bookingVersion?.contract_code?.type_account_id,
            },
          },
          ...(!!bookingVersion?.contract_code?.ref_contract_code_by_main_id && {
            ref_contract_code_by_main: {
              connect: {
                id: bookingVersion?.contract_code?.ref_contract_code_by_main_id,
              },
            },
          }),
          ...(!!bookingVersion?.contract_code?.id && {
            ref_contract_code_by: {
              connect: {
                id: bookingVersion?.contract_code?.id,
              },
            },
          }),
          // shadow_period: bookingVersion?.contract_code?.shadow_period,
          shadow_period: shadowPeriod ? Number(shadowPeriod) : 0,
          shadow_time: bookingVersion?.contract_code?.shadow_time,
          file_period_mode: bookingVersion?.contract_code?.file_period_mode,
          fixdayday: bookingVersion?.contract_code?.fixdayday,
          todayday: bookingVersion?.contract_code?.todayday,
          contract_start_date: fromDate
            ? getTodayNowDDMMYYYYDfault(fromDate).toDate()
            : null,
          contract_end_date: toDate
            ? getTodayNowDDMMYYYYDfault(toDate).toDate()
            : null,

          submitted_timestamp: nowDate,
          create_date: nowDate,
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      try {
        //terminate เก่า
        // ยังไม่ได้รองรับจากปุ่ม amd เพิ่ม field termidate
        await this.updateStatusCapacityRequestManagement(
          bookingVersion?.contract_code?.id,
          {
            status_capacity_request_management_id: 5,
            terminate_date: terminateDate
              ? getTodayNowAdd7(terminateDate).toDate()
              : null,

            // shadow_time: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            // shadow_period: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            // reject_reasons: null, //"comment.." //status_capacity_request_management_id 3 ต้องมี ไม่ 3 ให้ null
          },
          userId,
          null,
        );
      } catch (error) {
        console.log('3');
        console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
      }

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
          create_date: nowDate,
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
          contract_start_date: fromDate
            ? getTodayNowDDMMYYYYDfault(fromDate).toDate()
            : null,
          contract_end_date: toDate
            ? getTodayNowDDMMYYYYDfault(toDate).toDate()
            : null,
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
          data_temp: booking_full_json[0]?.data_temp,
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

          zone_text: newEntry[i]?.zone_text,
          area_text: newEntry[i]?.area_text,
          contract_point: newEntry[i]?.contract_point,
          flag_use: true,
          data_temp: newEntry[i]?.data_temp,
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }

      for (let i = 0; i < newExit.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 2,

          zone_text: newExit[i]?.zone_text,
          area_text: newExit[i]?.area_text,
          contract_point: newExit[i]?.contract_point,
          flag_use: true,
          data_temp: newExit[i]?.data_temp,
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });

      try {
        await this.updateStatusCapacityRequestManagement(
          createContractCodeAmd?.id,
          {
            status_capacity_request_management_id: 2,
            terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
            // shadow_time: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            // shadow_period: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            // reject_reasons: null, //"comment.." //status_capacity_request_management_id 3 ต้องมี ไม่ 3 ให้ null
          },
          userId,
          null,
        );
      } catch (error) {
        console.log('4');
        console.warn('⚠️ ละเว้น Error:', error.message); // แสดงเฉพาะ Warning แต่ไม่ให้โปรแกรมหยุด
      }

      // path detail
    } else {
      console.log('ver');
      console.log('fromDate : ', fromDate);
      console.log(
        'getTodayNowDDMMYYYYDfault(fromDate).toDate() : ',
        getTodayNowDDMMYYYYDfault(fromDate).toDate(),
      );
      // getTodayNowYYYYMMDDDfaultAdd7
      // if (flagFromTo) {

      await this.prisma.contract_code.updateMany({
        where: {
          id: bookingVersion?.contract_code?.id,
        },
        data: {
          shadow_period: shadowPeriod ? Number(shadowPeriod) : 0,
          contract_start_date: fromDate
            ? getTodayNowDDMMYYYYDfault(fromDate).toDate()
            : null,
          contract_end_date: toDate
            ? getTodayNowDDMMYYYYDfault(toDate).toDate()
            : null,
        },
      });

      await this.prisma.booking_version.updateMany({
        where: {
          contract_code_id: bookingVersion?.contract_code?.id,
        },
        data: {
          flag_use: false,
        },
      });

      const checkContractCodeCheckLength =
        await this.prisma.booking_version.count({
          where: {
            contract_code_id: bookingVersion?.contract_code?.id,
          },
        });
      // console.log(status === 2 && getTodayNowYYYYMMDDDfaultAdd7(fromDate).isSameOrBefore(getTodayNowAdd7()));
      console.log('bookingVersion : ', bookingVersion);
      const versId = await this.prisma.booking_version.create({
        data: {
          version: `v.${checkContractCodeCheckLength + 1}`,
          ...(!!bookingVersion?.contract_code?.id && {
            // new create ..
            contract_code: {
              connect: {
                id: bookingVersion?.contract_code?.id,
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
              id: bookingVersion?.contract_code?.type_account_id,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: bookingVersion?.contract_code
                ?.status_capacity_request_management_id,
            },
          },
          contract_start_date: fromDate
            ? getTodayNowDDMMYYYYDfault(fromDate).toDate()
            : null,
          contract_end_date: toDate
            ? getTodayNowDDMMYYYYDfault(toDate).toDate()
            : null,
        },
      });

      console.log('newEntry : ', newEntry);
      console.log('newExit : ', newExit);

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
          data_temp: booking_full_json[0]?.data_temp,
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

          zone_text: newEntry[i]?.zone_text,
          area_text: newEntry[i]?.area_text,
          contract_point: newEntry[i]?.contract_point,
          flag_use: true,
          data_temp: newEntry[i]?.data_temp,
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }

      for (let i = 0; i < newExit.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 2,

          zone_text: newExit[i]?.zone_text,
          area_text: newExit[i]?.area_text,
          contract_point: newExit[i]?.contract_point,
          flag_use: true,
          data_temp: newExit[i]?.data_temp,
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      console.log('mapDataRowJson : ', mapDataRowJson);
      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });
      //
      console.log('status : ', status);
      console.log('bookingVersion?.contract_code?.id : ', bookingVersion?.contract_code?.id);
      if(status === 2){
        // คืนค่า
        console.log('คืนค่า');
      const specificVersion = await this.prisma.booking_version.findFirst({
        where: {
          contract_code_id: Number(bookingVersion?.contract_code?.id),
          flag_use: false,
          status_capacity_request_management_id: 2,
        },
        include:{
          contract_code:true,
        },
        orderBy: { id: 'desc' },
      });
      const { setDataUse: resetDataUse } =
        await this.capacityMiddleService.middleBooking(
          bookingVersion?.contract_code?.id,
          true,
          specificVersion.id,
        );
      await this.capacityMiddleService.processGenPublicData(resetDataUse, true);
        
        console.log('ค่าใหม่');

      const { pnmatchData, setDataUse, logWarnings } =
        await this.capacityMiddleService.middleBooking(bookingVersion?.contract_code?.id, false);
        console.log('edit v setDataUse : ', setDataUse);
        console.log('edit v pnmatchData : ', pnmatchData);
        await this.capacityMiddleService.processGenPublicData(
          setDataUse,
          false,
        );
        console.log('- - - - - -');
        console.log('path detail process...');
        console.time('path detail');
        await this.capacityMiddleService.genPathDetail(
          setDataUse,
          pnmatchData,
          bookingVersion?.contract_code?.id,
          userId,
        );
        console.timeEnd('path detail');

      }

    }

    return bookingVersion;
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
    newBK['booking_full_json'] = await newBK?.booking_full_json.map(
      (e: any) => {
        const data_temp = JSON.parse(e['data_temp']);
        return { ...e, data_temp: data_temp };
      },
    );
    newBK['booking_row_json'] = await newBK?.booking_row_json.map((e: any) => {
      const data_temp = JSON.parse(e['data_temp']);
      return { ...e, data_temp: data_temp };
    });

    const shipperInfo =
      newBK['booking_full_json'][0]['data_temp']['shipperInfo'];

    const ShipperName = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]['Shipper Name'];
      })
      .find((item) => item !== undefined);
    const typeOfContract: any = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]['Type of Contract'];
      })
      .find((item) => item !== undefined);
    const ContractCode = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]['Contract Code'];
      })
      .find((item) => item !== undefined);

    // headerEntry
    const headerEntryInfo1 =
      newBK['booking_full_json'][0]['data_temp']['headerEntry'][
        'Capacity Daily Booking (MMBTU/d)'
      ];

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
    const newEntry = this.capacityMiddleService.transformDataArrNew(entryValue);
    const exitValue = newBK['booking_full_json'][0]['data_temp']['exitValue'];
    const newExit = this.capacityMiddleService.transformDataArrNew(exitValue);
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

    console.log('newEntry.length : ', newEntry.length);

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

  private w(res: Response, s: string) {
    res.write(s);
  }
  private j(v: any) {
    return JSON.stringify(v);
  }
  private fm(d: Date) {
    return dayjs(d).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
  }

  /**
   * ส่งผลลัพธ์ "เหมือน getPeriodOld" แต่สตรีม JSON เป็นชิ้นๆ
   * ไม่ต้องแก้ฟังก์ชันฝั่งหน้าเว็บ (ยัง .map() ได้เหมือนเดิม)
   */
  async streamGetPeriodOld(id: number, res: Response) {
    const baseWhere = {
      period: { not: null as any },
      capacity_detail_point: {
        capacity_detail: { flag_use: true, contract_code_id: Number(id) },
      },
    };

    // กันยิงจักรวาลจนพังกลางทาง
    const MAX_ROWS = 1_000_000; // ปรับตามเครื่องได้
    const totalRows = await this.prisma.capacity_detail_point_date.count({
      where: baseWhere,
    });
    if (totalRows > MAX_ROWS) {
      res.status(413);
      this.w(
        res,
        this.j({ status: 413, error: `Payload too large: ${totalRows} rows` }),
      );
      return res.end();
    }

    // === เตรียม period + start/endDate (ตามลอจิกเดิม) ===
    const gb = await this.prisma.capacity_detail_point_date.groupBy({
      by: ['period'],
      where: baseWhere,
      _min: { date: true },
      _max: { date: true },
    });

    if (!gb.length) {
      this.w(res, '[]');
      return res.end();
    }

    const metas = gb
      .map((g) => ({
        period: g.period as any,
        minDate: g._min.date as Date,
        maxDate: g._max.date as Date,
      }))
      .sort(
        (a, b) => (a.minDate?.getTime() ?? 0) - (b.minDate?.getTime() ?? 0),
      );

    for (let i = 0; i < metas.length; i++) {
      const next = metas[i + 1];
      (metas[i] as any).startISO = this.fm(metas[i].minDate);
      (metas[i] as any).endISO = next
        ? dayjs(next.minDate)
            .subtract(1, 'day')
            .format('YYYY-MM-DDTHH:mm:ss.SSS[Z]')
        : this.fm(metas[i].maxDate);
    }

    // === เริ่มสตรีม Array ของ period ===
    this.w(res, '[');

    for (let pi = 0; pi < metas.length; pi++) {
      const meta = metas[pi];
      if (pi) this.w(res, ',');

      // เปิด object period
      this.w(res, '{');
      this.w(
        res,
        `"period":${this.j(meta.period)},"startDate":${this.j((meta as any).startISO)},"endDate":${this.j(
          (meta as any).endISO,
        )},"data":[`,
      );

      // state สำหรับเปิด/ปิดก้อน area/point/rows
      let firstArea = true;
      let currentAreaId: number | null = null;

      let firstPointInArea = true;
      let currentPointId: number | null = null;

      let firstRowInPoint = true;
      let rowsOpen = false;

      const pageSize = 2000; // เท่าของเดิมได้
      let skip = 0;
      let hasMore = true;

      while (hasMore) {
        const rows = await this.prisma.capacity_detail_point_date.findMany({
          where: { ...baseWhere, period: meta.period },
          select: {
            path_id: true,
            id: true,
            date: true,
            period: true,
            area_id: true,
            value: true,
            ck_comparea: true,
            ckCompare: true,
            adjust: true,
            adjust_type: true,
            area_nominal_capacity: true,
            cals: true,
            release: true,
            capacity_detail_point_id: true,
            area: {
              select: {
                id: true,
                name: true,
                color: true,
                entry_exit: { select: { name: true } },
              },
            },
            capacity_detail_point: {
              select: {
                id: true,
                path_temp: true,
                capacity_detail_id: true,
                area_id: true,
                area: {
                  select: {
                    id: true,
                    name: true,
                    color: true,
                    entry_exit: { select: { name: true } },
                  },
                },
              },
            },
          },
          // เรียงให้ไหลเป็น group แบบเดียวกับ getPeriodOld
          orderBy: [
            { area_id: 'asc' },
            { capacity_detail_point_id: 'asc' },
            { date: 'asc' },
          ],
          skip,
          take: pageSize,
        });

        if (!rows.length) {
          hasMore = false;
          break;
        }

        for (const item of rows) {
          // เปลี่ยน area → ปิดของเก่า เปิดของใหม่
          if (currentAreaId !== item.area_id) {
            if (rowsOpen) {
              this.w(res, ']');
              rowsOpen = false;
            }
            if (currentPointId !== null) {
              this.w(res, '}');
              currentPointId = null;
            }
            if (currentAreaId !== null) {
              this.w(res, ']}');
            } // ปิด area เดิม

            if (!firstArea) this.w(res, ',');
            firstArea = false;

            this.w(
              res,
              `{"area_id":${item.area_id},"area":${this.j(item.area)},"dataGroupArea":[`,
            );
            currentAreaId = item.area_id;
            firstPointInArea = true;
          }

          // เปลี่ยน point → ปิด point เดิม เปิด point ใหม่
          if (currentPointId !== item.capacity_detail_point_id) {
            if (rowsOpen) {
              this.w(res, ']');
              rowsOpen = false;
            }
            if (!firstPointInArea) this.w(res, ',');
            firstPointInArea = false;

            this.w(
              res,
              `{"capacity_detail_point":${this.j(item.capacity_detail_point)},"capacity_detail_point_id":${item.capacity_detail_point_id},"data":[`,
            );
            currentPointId = item.capacity_detail_point_id;
            firstRowInPoint = true;
            rowsOpen = true;
          }

          // แถวดิบคงเดิม
          if (!firstRowInPoint) this.w(res, ',');
          firstRowInPoint = false;
          this.w(res, this.j(item));
        }

        skip += rows.length;
        hasMore = rows.length === pageSize;
      }

      // ปิดก้อนที่ยังเปิดอยู่ใน period นี้
      if (rowsOpen) {
        this.w(res, ']');
        rowsOpen = false;
      }
      if (currentPointId !== null) {
        this.w(res, '}');
        currentPointId = null;
      }
      if (currentAreaId !== null) {
        this.w(res, ']}');
        currentAreaId = null;
      }

      // ปิด "data": [...] และปิด object period
      this.w(res, ']}');
    }

    // ปิด array ใหญ่ แล้วจบสตรีม
    this.w(res, ']');
    res.end();
  }
  // JSON.stringify
  async getPeriodOLD(id: any) {
    // const pageSize = 1000; // หรือปรับตามเหมาะสม
    const pageSize = 2000; // หรือปรับตามเหมาะสม
    let resData = [];
    let skip = 0;
    let hasMore = true;
    console.log('get');
    console.time('start');
    while (hasMore) {
      const resDataBatch =
        await this.prisma.capacity_detail_point_date.findMany({
          where: {
            period: { not: null },
            capacity_detail_point: {
              capacity_detail: {
                flag_use: true,
                contract_code_id: Number(id),
              },
            },
          },
          select: {
            path_id: true,
            id: true,
            date: true,
            period: true,
            area_id: true,
            value: true,
            ck_comparea: true,
            ckCompare: true,
            adjust: true,
            adjust_type: true,
            area_nominal_capacity: true,
            cals: true,
            release: true,
            capacity_detail_point_id: true,
            area: {
              select: {
                id: true,
                name: true,
                color: true,
                entry_exit: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            capacity_detail_point: {
              select: {
                id: true,
                // path_temp: true,
                // path_temp_json: true,
                capacity_detail_id: true,
                area_id: true,
                area: {
                  select: {
                    id: true,
                    name: true,
                    color: true,
                    entry_exit: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
          // include: {
          //   area: {
          //     select: {
          //       id: true,
          //       name: true,
          //       color: true,
          //       entry_exit: {
          //         select: {
          //           name: true,
          //         },
          //       },
          //     },
          //   },
          //   capacity_detail_point: {
          //     select: {
          //       id: true,
          //       path_temp: true,
          //       capacity_detail_id: true,
          //       area_id: true,
          //       area: {
          //         select: {
          //           id: true,
          //           name: true,
          //           color: true,
          //           entry_exit: {
          //             select: {
          //               name: true,
          //             },
          //           },
          //         },
          //       },
          //     },
          //   },
          // },
          orderBy: {
            date: 'asc',
          },
          skip: skip,
          take: pageSize,
        });
      // console.log('resDataBatch : ', resDataBatch);
      // processBatch
      resData = resData.concat(resDataBatch);
      skip += pageSize;
      // console.log('skip : ', skip);
      if (resDataBatch.length < pageSize) {
        hasMore = false; // ถ้าดึงมาไม่เต็ม batch แปลว่าไม่มีข้อมูลต่อแล้ว
      }
    }

    console.timeEnd('start');

    const pathManage = await this.prisma.capacity_detail_point.findFirst({
      where: {
        capacity_detail_point_date: {
          some: {
            period: { not: null },
            capacity_detail_point: {
              capacity_detail: {
                flag_use: true,
                contract_code_id: Number(id),
              },
            },
          },
        },
      },
    });

    // console.log('pathManage : ', pathManage);

    if (resData.length > 0) {
      const newResData = resData.map((e: any) => {
        return { ...e };
      });
      // console.log('2 newResData : ', newResData);

      const groupByPeriod = (data) => {
        return data.reduce((acc, curr) => {
          // หา period ที่มีอยู่ใน acc หรือสร้างใหม่ถ้าไม่มี
          const periodGroup = acc.find((group) => group.period === curr.period);
          if (periodGroup) {
            periodGroup.data.push(curr);
          } else {
            acc.push({
              period: curr.period,
              data: [curr],
            });
          }
          return acc;
        }, []);
      };

      // เรียกใช้ฟังก์ชัน
      const resultPeriod = groupByPeriod(newResData);
      // console.log('resultPeriod : ', resultPeriod);

      const addStartDate = (data) => {
        return data.map((group) => {
          // หาวันที่ที่น้อยที่สุดใน group.data โดยใช้ dayjs
          const startDate = group.data
            .map((item) => dayjs(item.date)) // แปลง date เป็น dayjs object
            .sort((a, b) => a.valueOf() - b.valueOf())[0]; // เรียงตามเวลาที่น้อยสุด

          return {
            ...group,
            startDate: startDate.format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'), // แปลงเป็น ISO string
          };
        });
      };

      // เรียกใช้งานฟังก์ชัน
      const resultStartDate = addStartDate(resultPeriod);
      // console.log('resultStartDate : ', resultStartDate);

      // ฟังก์ชันเพิ่ม endDate โดยดูจาก startDate ของ period ถัดไป
      const addEndDates = (data) => {
        return data.map((group, index, array) => {
          const nextGroup = array[index + 1]; // หา period ถัดไป
          const endDate = nextGroup
            ? dayjs(nextGroup.startDate)
                .subtract(1, 'day')
                .format('YYYY-MM-DDTHH:mm:ss.SSS[Z]')
            : group.data
                .map((item) => dayjs(item.date)) // ใช้วันที่จาก group.data
                .sort((a, b) => b.valueOf() - a.valueOf())[0] // เรียงตามวันที่มากสุด
                .format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'); // แปลงเป็น ISO string
          return {
            ...group,
            endDate, // ใส่ endDate ที่หาได้
          };
        });
      };

      // เรียกใช้ฟังก์ชัน
      const resultEndDate = addEndDates(resultStartDate);
      // console.log('resultEndDate : ', resultEndDate);

      // ฟังก์ชัน group data ตาม area_id
      const groupDataByArea = (data) => {
        return data.map((group) => {
          // ใช้ reduce จัดกลุ่มข้อมูลภายใน data ตาม area_id
          const groupedByArea = group.data.reduce((acc, item) => {
            const key = item.area_id;
            if (!acc[key]) {
              acc[key] = {
                area_id: key,
                area: item.area,
                dataGroupArea: [],
              };
            }
            acc[key].dataGroupArea.push(item);
            return acc;
          }, {});
          // แปลง object กลับเป็น array
          return {
            ...group,
            data: Object.values(groupedByArea),
          };
        });
      };

      // เรียกใช้ฟังก์ชัน
      const resultAreaGroup = groupDataByArea(resultEndDate);
      // console.log('resultAreaGroup : ', resultAreaGroup);

      // ฟังก์ชันจัดกลุ่มตาม capacity_detail_point_id
      const groupByCapacityDetailPointId = (data) => {
        return data.map((group) => ({
          ...group,
          data: group.data.map((areaGroup) => ({
            ...areaGroup,
            dataGroupArea: Object.values(
              areaGroup.dataGroupArea.reduce((acc, item) => {
                const key = item.capacity_detail_point_id;
                if (!acc[key]) {
                  acc[key] = {
                    capacity_detail_point: item?.capacity_detail_point,
                    capacity_detail_point_id: key,
                    data: [],
                  };
                }
                acc[key].data.push(item);
                return acc;
              }, {}),
            ),
          })),
        }));
      };

      const resultGroupPoint = groupByCapacityDetailPointId(resultAreaGroup);
      // console.log('resultGroupPoint : ', resultGroupPoint);
      // return resultGroupPoint;
      return {
        data: resultGroupPoint,
        pathManage: pathManage,
      };
    } else {
      return [];
    }
  }

  async duplicateVersion(id: any, userId: any) {
    const bookingVersion = await this.prisma.booking_version.findFirst({
      where: {
        id: Number(id),
      },
      include: {
        contract_code: true,
        booking_full_json: true,
        booking_row_json: true,
      },
    });

    const startDate = bookingVersion?.contract_code?.contract_start_date;
    const status =
      bookingVersion?.contract_code?.status_capacity_request_management_id;

    const nowDate = getTodayNowAdd7().toDate();

    const hasContractStarted =
      dayjs(nowDate).isAfter(dayjs(startDate)) ||
      dayjs(nowDate).isSame(dayjs(startDate));

    if (status === 2 && hasContractStarted) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'สัญญาเริ่มไปแล้ว duplicate ไม่ได้',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {
      await this.prisma.booking_version.updateMany({
        where: {
          contract_code_id: bookingVersion?.contract_code?.id,
        },
        data: {
          flag_use: false,
        },
      });

      const checkContractCodeCheckLength =
        await this.prisma.booking_version.count({
          where: {
            contract_code_id: bookingVersion?.contract_code?.id,
          },
        });

      const versId = await this.prisma.booking_version.create({
        data: {
          version: `v.${checkContractCodeCheckLength + 1}`,
          ...(!!bookingVersion?.contract_code?.id && {
            // new create ..
            contract_code: {
              connect: {
                id: bookingVersion?.contract_code?.id,
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
              id: bookingVersion?.contract_code?.type_account_id,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: bookingVersion?.contract_code
                ?.status_capacity_request_management_id,
            },
          },
          contract_start_date:
            bookingVersion?.contract_code?.contract_start_date,
          contract_end_date: bookingVersion?.contract_code?.contract_end_date,
        },
      });

      await this.prisma.contract_code.update({
        where: {
          id: bookingVersion?.contract_code?.id,
        },
        data: {
          submitted_timestamp: getTodayNowAdd7().toDate(),
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
          data_temp: bookingVersion?.booking_full_json[0]?.data_temp,
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
      const newEntry = bookingVersion?.booking_row_json.filter((f: any) => {
        return f?.entry_exit_id === 1;
      });
      for (let i = 0; i < newEntry.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 1,

          zone_text: newEntry[i]?.zone_text,
          area_text: newEntry[i]?.area_text,
          contract_point: newEntry[i]?.contract_point,
          flag_use: true,
          data_temp: newEntry[i]?.data_temp,
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      const newExit = bookingVersion?.booking_row_json.filter((f: any) => {
        return f?.entry_exit_id === 2;
      });
      for (let i = 0; i < newExit.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 2,

          zone_text: newExit[i]?.zone_text,
          area_text: newExit[i]?.area_text,
          contract_point: newExit[i]?.contract_point,
          flag_use: true,
          data_temp: newExit[i]?.data_temp,
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });
    }

    return bookingVersion;
  }


  // async getPeriodReplaceCapacityRight(id: any) {
  async getPeriod(id: any) {
    // const pageSize = 1000; // หรือปรับตามเหมาะสม
    const pageSize = 2000; // หรือปรับตามเหมาะสม
    let resData = [];
    let skip = 0;
    let hasMore = true;
    console.log('get');
    console.time('start');
    while (hasMore) {
      const resDataBatch =
        await this.prisma.capacity_detail_point_date.findMany({
          where: {
            period: { not: null },
            capacity_detail_point: {
              capacity_detail: {
                flag_use: true,
                contract_code_id: Number(id),
              },
            },
          },
          select: {
            path_id: true,
            id: true,
            date: true,
            period: true,
            area_id: true,
            value: true,
            ck_comparea: true,
            ckCompare: true,
            adjust: true,
            adjust_type: true,
            area_nominal_capacity: true,
            cals: true,
            release: true,
            capacity_detail_point_id: true,
            area: {
              select: {
                id: true,
                name: true,
                color: true,
                entry_exit: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            capacity_detail_point: {
              select: {
                id: true,
                // path_temp: true,
                // path_temp_json: true,
                capacity_detail_id: true,
                area_id: true,
                area: {
                  select: {
                    id: true,
                    name: true,
                    color: true,
                    entry_exit: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
          // include: {
          //   area: {
          //     select: {
          //       id: true,
          //       name: true,
          //       color: true,
          //       entry_exit: {
          //         select: {
          //           name: true,
          //         },
          //       },
          //     },
          //   },
          //   capacity_detail_point: {
          //     select: {
          //       id: true,
          //       path_temp: true,
          //       capacity_detail_id: true,
          //       area_id: true,
          //       area: {
          //         select: {
          //           id: true,
          //           name: true,
          //           color: true,
          //           entry_exit: {
          //             select: {
          //               name: true,
          //             },
          //           },
          //         },
          //       },
          //     },
          //   },
          // },
          orderBy: {
            date: 'asc',
          },
          skip: skip,
          take: pageSize,
        });
      // console.log('resDataBatch : ', resDataBatch);
      // processBatch
      resData = resData.concat(resDataBatch);
      skip += pageSize;
      // console.log('skip : ', skip);
      if (resDataBatch.length < pageSize) {
        hasMore = false; // ถ้าดึงมาไม่เต็ม batch แปลว่าไม่มีข้อมูลต่อแล้ว
      }
    }

    console.timeEnd('start');

    const pathManage = await this.prisma.capacity_detail_point.findFirst({
      where: {
        capacity_detail_point_date: {
          some: {
            period: { not: null },
            capacity_detail_point: {
              capacity_detail: {
                flag_use: true,
                contract_code_id: Number(id),
              },
            },
          },
        },
      },
    });

    const booking_full_json = await this.prisma.booking_full_json.findFirst({
      where: {
        booking_version: {
          flag_use: true,
          contract_code_id: Number(id),
        }
      },
      orderBy: {
        create_date: 'desc',
      },
      include:{
        booking_version: {
          select: {
            contract_code: {
              select: {
                term_type: true,
                term_type_id: true
              }
            }
          }
        }
      }
    })

    const bookingFull = JSON.parse(booking_full_json?.data_temp ?? '{}')

    const booking_row_json = await this.prisma.booking_row_json.findMany({
      where: {
        booking_version: {
          flag_use: true,
          contract_code_id: Number(id),
        },
        flag_use: true
      }
    })

    // console.log('pathManage : ', pathManage);

    if (resData.length > 0) {
      const newResData = resData.map((e: any) => {
        return { ...e };
      });
      // console.log('2 newResData : ', newResData);

      const groupByPeriod = (data) => {
        return data.reduce((acc, curr) => {
          // หา period ที่มีอยู่ใน acc หรือสร้างใหม่ถ้าไม่มี
          const periodGroup = acc.find((group) => group.period === curr.period);
          if (periodGroup) {
            periodGroup.data.push(curr);
          } else {
            acc.push({
              period: curr.period,
              data: [curr],
            });
          }
          return acc;
        }, []);
      };

      // เรียกใช้ฟังก์ชัน
      const resultPeriod = groupByPeriod(newResData);
      // console.log('resultPeriod : ', resultPeriod);

      const addStartDate = (data) => {
        return data.map((group) => {
          // หาวันที่ที่น้อยที่สุดใน group.data โดยใช้ dayjs
          const startDate = group.data
            .map((item) => dayjs(item.date)) // แปลง date เป็น dayjs object
            .sort((a, b) => a.valueOf() - b.valueOf())[0]; // เรียงตามเวลาที่น้อยสุด

          return {
            ...group,
            startDate: startDate.format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'), // แปลงเป็น ISO string
          };
        });
      };

      // เรียกใช้งานฟังก์ชัน
      const resultStartDate = addStartDate(resultPeriod);
      // console.log('resultStartDate : ', resultStartDate);

      // ฟังก์ชันเพิ่ม endDate โดยดูจาก startDate ของ period ถัดไป
      const addEndDates = (data) => {
        return data.map((group, index, array) => {
          const nextGroup = array[index + 1]; // หา period ถัดไป
          const endDate = nextGroup
            ? dayjs(nextGroup.startDate)
                .subtract(1, 'day')
                .format('YYYY-MM-DDTHH:mm:ss.SSS[Z]')
            : group.data
                .map((item) => dayjs(item.date)) // ใช้วันที่จาก group.data
                .sort((a, b) => b.valueOf() - a.valueOf())[0] // เรียงตามวันที่มากสุด
                .format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'); // แปลงเป็น ISO string
          return {
            ...group,
            endDate, // ใส่ endDate ที่หาได้
          };
        });
      };

      // เรียกใช้ฟังก์ชัน
      const resultEndDate = addEndDates(resultStartDate);
      // console.log('resultEndDate : ', resultEndDate);

      // ฟังก์ชัน group data ตาม area_id
      const groupDataByArea = (data) => {
        return data.map((group) => {
          const startDate = dayjs(group.startDate, 'YYYY-MM-DDTHH:mm:ss.SSS[Z]')
          const endDate = dayjs(group.endDate, 'YYYY-MM-DDTHH:mm:ss.SSS[Z]')
          // ใช้ reduce จัดกลุ่มข้อมูลภายใน data ตาม area_id
          const groupedByArea = group.data.reduce((acc, item) => {
            const key = item.area_id;
            if (!acc[key]) {
              const isShortTermNonFirm = booking_full_json?.booking_version?.contract_code?.term_type_id == 4
              const dateArray: string[] = [];
              let current = startDate;
              if(isShortTermNonFirm){
                while (current.isSameOrBefore(endDate)) {
                  dateArray.push(current.tz('Asia/Bangkok').format('DD/MM/YYYY'));
                  current = current.add(1, 'day');
                }
              }
              else{
                current = startDate.startOf('month');
                while (current.isSameOrBefore(endDate)) {
                  dateArray.push(current.tz('Asia/Bangkok').format('DD/MM/YYYY'));
                  current = current.add(1, 'month');
                }
              }

              let bookingValueList = []
              if(isMatch(item.area?.entry_exit?.name, 'Entry') && bookingFull?.headerEntry?.['Capacity Daily Booking (MMBTU/d)'] && bookingFull?.entryValue && Array.isArray(bookingFull?.entryValue)) {
                const header = bookingFull?.headerEntry?.['Capacity Daily Booking (MMBTU/d)']
                Object.keys(header)
                .filter(key => dateArray.includes(key))
                .map(key => bookingValueList.push({
                  date: key,
                  key: header[key].key,
                  value: null
                }))
                

                booking_row_json.filter(row => {
                  return row.entry_exit_id == 1 && isMatch(row.area_text, item.area?.name)
                }).map(row => {
                  const dataTemp = JSON.parse(row.data_temp)
                  bookingValueList = bookingValueList.map((bookingValue: any) => {
                    const value = parseToNumber(dataTemp[bookingValue.key])
                    if(bookingValue.value != null && value != null){
                      bookingValue.value = bookingValue.value + value
                    }
                    else{
                      bookingValue.value = value
                    }
                    return bookingValue
                  })
                })
              }
              else if(isMatch(item.area?.entry_exit?.name, 'Exit') && bookingFull?.headerExit?.['Capacity Daily Booking (MMBTU/d)'] && bookingFull?.exitValue && Array.isArray(bookingFull?.exitValue)) {
                const header = bookingFull?.headerExit?.['Capacity Daily Booking (MMBTU/d)']
                Object.keys(header)
                .filter(key => dateArray.includes(key))
                .map(key => bookingValueList.push({
                  date: key,
                  key: header[key].key,
                  value: null
                }))

                booking_row_json.filter(row => {
                  return row.entry_exit_id == 2 && isMatch(row.area_text, item.area?.name)
                }).map(row => {
                  const dataTemp = JSON.parse(row.data_temp)
                  bookingValueList = bookingValueList.map((bookingValue: any) => {
                    const value = parseToNumber(dataTemp[bookingValue.key])
                    if(bookingValue.value != null && value != null){
                      bookingValue.value = bookingValue.value + value
                    }
                    else{
                      bookingValue.value = value
                    }
                    return bookingValue
                  })
                })
              }

              acc[key] = {
                area_id: key,
                area: item.area,
                capacityRight: Math.max(...bookingValueList.map(booking => booking.value || 0)),
                dataGroupArea: [],
              };
            }
            acc[key].dataGroupArea.push(item);
            return acc;
          }, {});
          // แปลง object กลับเป็น array
          return {
            ...group,
            data: Object.values(groupedByArea),
          };
        });
      };

      // เรียกใช้ฟังก์ชัน
      const resultAreaGroup = groupDataByArea(resultEndDate);
      // console.log('resultAreaGroup : ', resultAreaGroup);

      // ฟังก์ชันจัดกลุ่มตาม capacity_detail_point_id
      const groupByCapacityDetailPointId = (data) => {
        return data.map((group) => ({
          ...group,
          data: group.data.map((areaGroup) => ({
            ...areaGroup,
            dataGroupArea: Object.values(
              areaGroup.dataGroupArea.reduce((acc, item) => {
                const key = item.capacity_detail_point_id;
                if (!acc[key]) {
                  acc[key] = {
                    capacity_detail_point: item?.capacity_detail_point,
                    capacity_detail_point_id: key,
                    data: [],
                  };
                }
                acc[key].data.push(item);
                return acc;
              }, {}),
            ),
          })),
        }));
      };

      const resultGroupPoint = groupByCapacityDetailPointId(resultAreaGroup);
      // console.log('resultGroupPoint : ', resultGroupPoint);
      // return resultGroupPoint;
      return {
        data: resultGroupPoint,
        pathManage: pathManage,
      };
    } else {
      return [];
    }
  }

  // release-capacity-submission

}
