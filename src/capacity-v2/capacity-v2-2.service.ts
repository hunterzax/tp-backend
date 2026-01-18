/**
 * =====================================================================================
 * CAPACITY V2.2 SERVICE - ระบบจัดการความจุ (Capacity Management System)
 * =====================================================================================
 * 
 * บริการหลักสำหรับจัดการความจุของระบบขนส่งก๊าซธรรมชาติ
 * ครอบคลุมการจัดการ:
 * - การขอจองความจุ (Capacity Request Management)
 * - การจัดการไฟล์และเทมเพลต (File & Template Management)
 * - การประมวลผลข้อมูลการจอง (Booking Data Processing)
 * - การส่งออกรายงาน (Report Export)
 * - การจัดการเวอร์ชัน (Version Management)
 * - การขยายสัญญา (Contract Extension)
 * 
 * @author Development Team
 * @version 2.2
 * @since 2024
 * =====================================================================================
 */

// =====================================================================================
// CORE NESTJS IMPORTS - การนำเข้าโมดูลหลักของ NestJS
// =====================================================================================
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';

// =====================================================================================
// UTILITY LIBRARIES - ไลบรารีสำหรับการทำงานต่างๆ
// =====================================================================================
import * as bcrypt from 'bcrypt'; // สำหรับการเข้ารหัสรหัสผ่าน
import * as XLSX from 'xlsx-js-style'; // สำหรับการสร้างและจัดการไฟล์ Excel
import * as fs from 'fs'; // สำหรับการจัดการไฟล์ระบบ
import * as FormData from 'form-data'; // สำหรับการส่งข้อมูลแบบ multipart/form-data

// =====================================================================================
// EXPRESS & HTTP RESPONSE - สำหรับการจัดการ HTTP Response
// =====================================================================================
import { Response } from 'express';

// =====================================================================================
// DATE & TIME UTILITIES - ไลบรารีสำหรับจัดการวันที่และเวลา
// =====================================================================================
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc'; // Plugin สำหรับ UTC timezone
import timezone from 'dayjs/plugin/timezone'; // Plugin สำหรับ timezone conversion
import isBetween from 'dayjs/plugin/isBetween'; // Plugin สำหรับตรวจสอบช่วงเวลา
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'; // Plugin สำหรับเปรียบเทียบวันที่
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'; // Plugin สำหรับเปรียบเทียบวันที่

// =====================================================================================
// HTTP CLIENT & EXTERNAL SERVICES - สำหรับการเรียก API ภายนอก
// =====================================================================================
import axios from 'axios';

// =====================================================================================
// INTERNAL SERVICES - บริการภายในของระบบ
// =====================================================================================
import { PathManagementService } from 'src/path-management/path-management.service';
import { Prisma } from '@prisma/client';
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { FileUploadService } from 'src/grpc/file-service.service';
import { CapacityMiddleService } from './capacity-middle.service';

// =====================================================================================
// UTILITY FUNCTIONS - ฟังก์ชันช่วยเหลือต่างๆ
// =====================================================================================
import {
  getTodayEndAdd7, // วันที่สิ้นสุดวันนี้ + 7 วัน
  getTodayNowAdd7, // วันที่และเวลาปัจจุบัน + 7 วัน
  getTodayNowDDMMYYYYAdd7, // วันที่ปัจจุบันในรูปแบบ DD/MM/YYYY + 7 วัน
  getTodayNowDDMMYYYYDfault, // วันที่ปัจจุบันในรูปแบบ DD/MM/YYYY
  getTodayNowDDMMYYYYDfaultAdd7, // วันที่ปัจจุบันในรูปแบบ DD/MM/YYYY + 7 วัน
  getTodayNowYYYYMMDDDfaultAdd7, // วันที่ปัจจุบันในรูปแบบ YYYY-MM-DD + 7 วัน
  getTodayStartAdd7, // วันที่เริ่มต้นวันนี้ + 7 วัน
} from 'src/common/utils/date.util';
import { uploadFilsTemp } from 'src/common/utils/uploadFileIn';

// =====================================================================================
// DAYJS PLUGIN CONFIGURATION - การตั้งค่า plugins ของ dayjs
// =====================================================================================
dayjs.extend(isSameOrBefore); // เปิดใช้งาน plugin สำหรับเปรียบเทียบวันที่
dayjs.extend(isSameOrAfter); // เปิดใช้งาน plugin สำหรับเปรียบเทียบวันที่
dayjs.extend(isBetween); // เปิดใช้งาน plugin สำหรับตรวจสอบช่วงเวลา
dayjs.extend(utc); // เปิดใช้งาน plugin สำหรับ UTC timezone
dayjs.extend(timezone); // เปิดใช้งาน plugin สำหรับ timezone conversion

/**
 * =====================================================================================
 * CAPACITY V2.2 SERVICE CLASS
 * =====================================================================================
 * 
 * บริการหลักสำหรับจัดการความจุของระบบขนส่งก๊าซธรรมชาติ
 * รับผิดชอบการประมวลผลข้อมูลการจอง การจัดการไฟล์ และการส่งออกรายงาน
 * 
 * @Injectable() - ใช้สำหรับ Dependency Injection ของ NestJS
 */
@Injectable()
export class CapacityV22Service {
  /**
   * =====================================================================================
   * CONSTRUCTOR - การกำหนดค่าเริ่มต้นและ Dependency Injection
   * =====================================================================================
   * 
   * @param jwtService - บริการสำหรับจัดการ JWT Token (การยืนยันตัวตน)
   * @param prisma - บริการสำหรับการเชื่อมต่อฐานข้อมูล (ORM)
   * @param uploadTemplateForShipperService - บริการสำหรับจัดการเทมเพลตการอัปโหลด
   * @param fileUploadService - บริการสำหรับการอัปโหลดไฟล์ผ่าน gRPC
   * @param capacityMiddleService - บริการกลางสำหรับจัดการความจุ
   * @param cacheService - บริการสำหรับการจัดการ Cache (ถูกปิดใช้งานชั่วคราว)
   */
  constructor(
    private jwtService: JwtService, // บริการ JWT สำหรับการยืนยันตัวตน
    private prisma: PrismaService, // บริการฐานข้อมูล Prisma ORM
    private readonly uploadTemplateForShipperService: UploadTemplateForShipperService, // บริการจัดการเทมเพลต
    private readonly fileUploadService: FileUploadService, // บริการอัปโหลดไฟล์
    private readonly capacityMiddleService: CapacityMiddleService, // บริการกลางจัดการความจุ
    // @Inject(CACHE_MANAGER) private cacheService: Cache, // บริการ Cache (ปิดใช้งานชั่วคราว)
  ) {}

  /**
   * =====================================================================================
   * CAPACITY REQUEST MANAGEMENT ONCE - ดึงข้อมูลการจัดการความจุครั้งเดียว
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับดึงข้อมูลการจัดการความจุทั้งหมดของสัญญาเฉพาะ
   * รวมถึงข้อมูลที่เกี่ยวข้องทั้งหมด เช่น ความคิดเห็น ไฟล์ สถานะ และเวอร์ชันต่างๆ
   * 
   * @param id - ID ของสัญญา (contract_code) ที่ต้องการดึงข้อมูล
   * @returns Promise<any[]> - ข้อมูลการจัดการความจุทั้งหมดของสัญญา
   * 
   * @description
   * - ดึงข้อมูลสัญญาจากฐานข้อมูลพร้อมข้อมูลที่เกี่ยวข้องทั้งหมด
   * - รวมข้อมูลผู้สร้างและผู้แก้ไขในแต่ละส่วน
   * - เรียงลำดับตาม ID จากมากไปน้อย (ล่าสุดก่อน)
   * - ใช้สำหรับการแสดงรายละเอียดสัญญาในหน้า UI
   */
  async capacityRequestManagementOnce(id: any) {
    // ดึงข้อมูลสัญญาจากฐานข้อมูลพร้อมข้อมูลที่เกี่ยวข้องทั้งหมด
    const resData = await this.prisma.contract_code.findMany({
      where: {
        id: Number(id), // แปลง ID เป็นตัวเลข
      },
      include: {
        // ข้อมูลประเภทบัญชี
        type_account: true,
        // ข้อมูลประเภทสัญญา
        term_type: true,
        // ข้อมูลอ้างอิงสัญญา
        ref_contract_code_by: true,
        // ข้อมูลกลุ่ม
        group: true,
        // ความคิดเห็นการจัดการความจุ
        submission_comment_capacity_request_management: {
          include: {
            // ข้อมูลผู้สร้างความคิดเห็น
            create_by_account: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
            // ข้อมูลผู้แก้ไขความคิดเห็น
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
        // สถานะกระบวนการจัดการความจุ
        status_capacity_request_management_process: true,
        // สถานะการจัดการความจุ
        status_capacity_request_management: true,
        // ไฟล์การจัดการความจุ
        file_capacity_request_management: {
          include: {
            // ข้อมูลผู้สร้างไฟล์
            create_by_account: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
            // ข้อมูลผู้แก้ไขไฟล์
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
        // การขยายสัญญาการจัดการความจุ
        extend_contract_capacity_request_management: true,
        // การจองการจัดการความจุ
        book_capacity_request_management: {
          include: {
            // ข้อมูลผู้สร้างการจอง
            create_by_account: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
            // ข้อมูลผู้แก้ไขการจอง
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
        // ข้อมูลผู้สร้างสัญญา
        create_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        // ข้อมูลผู้แก้ไขสัญญา
        update_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        // เวอร์ชันการจอง
        booking_version: {
          include: {
            // ความคิดเห็นเวอร์ชันการจอง
            booking_version_comment: {
              include: {
                // ข้อมูลผู้สร้างความคิดเห็นเวอร์ชัน
                create_by_account: {
                  select: {
                    id: true,
                    email: true,
                    first_name: true,
                    last_name: true,
                  },
                },
                // ข้อมูลผู้แก้ไขความคิดเห็นเวอร์ชัน
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
            // JSON ข้อมูลการจองแบบเต็ม
            booking_full_json: true,
            // JSON ข้อมูลการจองแบบแถว
            booking_row_json: true,
            // JSON ข้อมูลการจองแบบเต็มสำหรับการปล่อย
            booking_full_json_release: true,
            // JSON ข้อมูลการจองแบบแถวสำหรับการปล่อย
            booking_row_json_release: true,
            // ข้อมูลผู้สร้างเวอร์ชัน
            create_by_account: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
            // ข้อมูลผู้แก้ไขเวอร์ชัน
            update_by_account: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
            // สถานะการจัดการความจุของเวอร์ชัน
            status_capacity_request_management: true,
            // ประเภทบัญชีของเวอร์ชัน
            type_account: true,
          },
          orderBy: {
            id: 'desc', // เรียงลำดับเวอร์ชันจากใหม่ไปเก่า
          },
        },
      },
      orderBy: { id: 'desc' }, // เรียงลำดับสัญญาจากใหม่ไปเก่า
    });

    return resData; // ส่งคืนข้อมูลสัญญาทั้งหมด
  }

  /**
   * =====================================================================================
   * PATH DETAIL CAPACITY REQUEST MANAGEMENT TRANSFORM NEW - แปลงข้อมูลการจัดการความจุใหม่
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับประมวลผลและแปลงข้อมูลการจัดการความจุจากไฟล์ที่อัปโหลด
   * ตรวจสอบความถูกต้องของข้อมูลและสร้างสัญญาการจัดการความจุใหม่
   * 
   * @param data - ข้อมูล JSON ที่แปลงจากไฟล์ Excel
   * @param userId - ID ของผู้ใช้ที่ทำการอัปโหลด
   * @param file - ไฟล์ที่อัปโหลด
   * @param token - JWT Token สำหรับการยืนยันตัวตน
   * @returns Promise<any> - ผลลัพธ์การประมวลผลข้อมูล
   * 
   * @description
   * - แปลงข้อมูลจาก JSON ที่ได้จากไฟล์ Excel
   * - ตรวจสอบข้อมูล Shipper และ Contract Code
   * - ตรวจสอบสิทธิ์ผู้ใช้และความถูกต้องของข้อมูล
   * - สร้างสัญญาการจัดการความจุใหม่ในฐานข้อมูล
   * - รองรับการใช้งานกับ Contract types ต่างๆ
   */
  async pathDetailCapacityRequestManagementTranformNew(
    data: any,
    userId: any,
    file: any,
    token: any,
  ) {
    // แปลงข้อมูล JSON จากไฟล์ที่อัปโหลด
    const resultTranform = (await JSON.parse(data?.json_data)) || null;
    
    // แยกข้อมูลส่วนต่างๆ จากไฟล์ Excel
    const headerEntry = resultTranform?.headerEntry || {}; // หัวตารางข้อมูลเข้า
    const entryValue = resultTranform?.entryValue || []; // ข้อมูลการเข้า
    const headerExit = resultTranform?.headerExit || {}; // หัวตารางข้อมูลออก
    const exitValue = resultTranform?.exitValue || []; // ข้อมูลการออก
    const sumEntries = resultTranform?.sumEntries || {}; // ผลรวมข้อมูลเข้า
    const sumExits = resultTranform?.sumExits || {}; // ผลรวมข้อมูลออก

    // กำหนดสถานะการประมวลผล (1 = สำเร็จ, 2 = เตือน)
    let typeSuccess = 1;

    // ตัวแปรสำหรับเก็บข้อมูล Shipper
    let shipperName = null; // ชื่อ Shipper
    let typeOfContract = null; // ประเภทสัญญา
    let contractCode = null; // รหัสสัญญา

    // ดึงข้อมูล Shipper Info จากไฟล์
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

    // แปลงประเภทสัญญาจากข้อความเป็นตัวเลข
    const typeOfContractText =
      this.capacityMiddleService.typeOfContractTextToNum(typeOfContract);

    // ค้นหาข้อมูลกลุ่มจากชื่อ Shipper
    const getGroupByName =
      await this.capacityMiddleService.getGroupByName(shipperName);

    // ตรวจสอบว่าพบข้อมูลกลุ่มหรือไม่
    if (!getGroupByName) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Shipper Info does not match the value.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // สร้างรายการจุดสัญญาจากข้อมูลกลุ่ม
    const contractPointSp = getGroupByName?.shipper_contract_point.map(
      (cp: any) => {
        return {
          contract_point: cp?.contract_point?.contract_point, // จุดสัญญา
          entry_exit_id: cp?.contract_point?.entry_exit_id, // ID จุดเข้า-ออก
        };
      },
    );

    // ตรวจสอบประเภทสัญญา
    if (!typeOfContractText) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Type Term Name is NOT match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // ตรวจสอบรหัสสัญญา
    if (!contractCode) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code not found. Please verify and try again.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // ตรวจสอบประเภทผู้ใช้และกลุ่ม
    const ckUserTypeGroup = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId), // ค้นหาจาก ID ผู้ใช้
          },
        },
      },
      include: {
        user_type: true, // รวมข้อมูลประเภทผู้ใช้
      },
    });

    // ตรวจสอบสิทธิ์ผู้ใช้ (user_type_id = 3 คือ Shipper)
    if (ckUserTypeGroup?.user_type_id === 3) {
      // ตรวจสอบว่าชื่อกลุ่มตรงกับชื่อ Shipper หรือไม่
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
                sum += parseFloat(entry[entryKey]?.replace(/,/g, '')) || 0;
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
                sum += parseFloat(exit[exitKey]?.replace(/,/g, '')) || 0;
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

    if (checkContractCode) {
      // มี
      if (shipperName !== checkContractCode?.group?.name) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
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
              // คืนค่าเก่า
              console.log('คืนค่าเก่า----');
              const { pnmatchData, setDataUse, logWarnings } = await this.capacityMiddleService.middleBooking(checkContractCodeCheckLast?.id, true);
              await this.capacityMiddleService.processGenPublicData(setDataUse);

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
            await this.updateStatusCapacityRequestManagement(
              checkContractCodeCheckLast?.id,
              {
                status_capacity_request_management_id: 5,
                terminate_date: minDate
                  ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
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
      type: typeSuccess,
      message:
        typeSuccess === 1
          ? 'Success.'
          : 'Zone, Area or Contract point is NOT match.',
      remark: `type 1 = Success, 2 = Warning`,
    };
  }

  /**
   * =====================================================================================
   * UPDATE STATUS CAPACITY REQUEST MANAGEMENT - อัปเดตสถานะการจัดการความจุ
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับอัปเดตสถานะการจัดการความจุตามสถานะต่างๆ
   * รองรับการอนุมัติ การปฏิเสธ และการยกเลิกสัญญา
   * 
   * @param id - ID ของสัญญาการจัดการความจุ
   * @param payload - ข้อมูลสำหรับอัปเดตสถานะ
   * @param userId - ID ของผู้ใช้ที่ทำการอัปเดต
   * @param req - Request object
   * @returns Promise<any> - ผลลัพธ์การอัปเดตสถานะ
   * 
   * @description
   * - อัปเดตสถานะการจัดการความจุตาม ID ที่กำหนด
   * - รองรับสถานะต่างๆ: อนุมัติ (2), ปฏิเสธ (3), ยกเลิก (4)
   * - บันทึกเหตุผลการปฏิเสธหรือยกเลิก
   * - อัปเดตวันที่สิ้นสุดสัญญา
   * - บันทึกข้อมูลผู้อัปเดตและเวลาที่อัปเดต
   */
  async updateStatusCapacityRequestManagement(
    id: any,
    payload: any,
    userId: any,
    req: any,
  ) {
    // แยกข้อมูลจาก payload
    const {
      status_capacity_request_management_id, // ID สถานะการจัดการความจุ
      terminate_date, // วันที่สิ้นสุดสัญญา
      shadow_time, // เวลาเงา
      shadow_period, // ระยะเวลาเงา
      reject_reasons, // เหตุผลการปฏิเสธ
    } = payload;
    
    let useData: any = null; // ข้อมูลที่จะใช้ในการอัปเดต
    
    // กำหนดช่วงเวลาปัจจุบัน (+7 วัน)
    const todayStart = getTodayStartAdd7().toDate(); // เริ่มต้นวันนี้ + 7 วัน
    const todayEnd = getTodayEndAdd7().toDate(); // สิ้นสุดวันนี้ + 7 วัน

    console.log('process...'); // แสดงสถานะการประมวลผล
    console.time('status'); // เริ่มจับเวลาการประมวลผล
    
    // ตรวจสอบสถานะการจัดการความจุ
    if (status_capacity_request_management_id === 2) {
      // สถานะ: อนุมัติ (Approved)
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        // shadow_time: shadow_time, // เวลาเงา (ถูกปิดใช้งาน)
        // shadow_period: shadow_period, // ระยะเวลาเงา (ถูกปิดใช้งาน)
        status_capacity_request_management_process: {
          connect: {
            id: 2, // สถานะกระบวนการ: อนุมัติ
          },
        },
      };
      console.log('useData --- : ', useData);
    } else if (status_capacity_request_management_id === 3) {
      // สถานะ: ปฏิเสธ (Rejected)
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        reject_reasons: reject_reasons, // บันทึกเหตุผลการปฏิเสธ
        status_capacity_request_management_process: {
          connect: {
            id: 5, // สถานะกระบวนการ: ปฏิเสธ
          },
        },
      };
    } else if (status_capacity_request_management_id === 5) {
      const terminateDay = getTodayNowAdd7(terminate_date).startOf('day');
      const todayDay = getTodayNowAdd7().startOf('day');

      const isTerminateTodayOrBefore = terminateDay.isSameOrBefore(
        todayDay,
        'day',
      );
      console.log('terminate_date : ', terminate_date);
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        terminate_date: terminate_date
          ? getTodayNowAdd7(terminate_date).toDate()
          : null,

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

      const { pnmatchData, setDataUse, logWarnings } = await this.capacityMiddleService.middleBooking(id, false);

      console.timeEnd('middleBooking process...');

      console.log('---> pnmatchData : ', pnmatchData);
      console.log('---> setDataUse : ', setDataUse);
      console.log('---> logWarnings : ', logWarnings);
      console.log('public date process...'); // 4468.201904296875 ms
      console.time('public date.');
      if (status_capacity_request_management_id === 2) {
        await this.capacityMiddleService.processGenPublicData(setDataUse);
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

      if (contractCodePeriod?.status_capacity_request_management_id === 2) {
        const { pnmatchData, setDataUse, logWarnings } =
          await this.capacityMiddleService.middleBooking(id, true);

        console.log('public date process...');
        console.time('public date');
        await this.capacityMiddleService.processGenPublicData(setDataUse);
        console.timeEnd('public date');

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
          comment: 'Re-Generated', // https://app.clickup.com/t/86etzcgvx
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
          comment: 'Re-Generated', // https://app.clickup.com/t/86etzcgvx
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

  /**
   * =====================================================================================
   * EXTEND CAPACITY REQUEST MANAGEMENT - ขยายสัญญาการจัดการความจุ
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับขยายสัญญาการจัดการความจุที่มีอยู่
   * อัปเดตวันที่เริ่มต้นและสิ้นสุดสัญญา พร้อมข้อมูลเงา
   * 
   * @param id - ID ของสัญญาการจัดการความจุ
   * @param payload - ข้อมูลสำหรับขยายสัญญา
   * @param userId - ID ของผู้ใช้ที่ทำการขยายสัญญา
   * @param req - Request object
   * @returns Promise<any> - ผลลัพธ์การขยายสัญญา
   * 
   * @description
   * - ขยายสัญญาการจัดการความจุที่มีอยู่
   * - อัปเดตวันที่เริ่มต้นและสิ้นสุดสัญญา
   * - บันทึกข้อมูลเวลาเงาและระยะเวลาเงา
   * - สร้างเวอร์ชันใหม่ของการจอง
   * - บันทึกข้อมูลผู้อัปเดตและเวลาที่อัปเดต
   */
  async extendCapacityRequestManagement(
    id: any,
    payload: any,
    userId: any,
    req: any,
  ) {
    // แยกข้อมูลจาก payload
    const {
      shadow_time, // เวลาเงา
      shadow_period, // ระยะเวลาเงา
      contract_start_date, // วันที่เริ่มต้นสัญญา
      contract_end_date, // วันที่สิ้นสุดสัญญา
    } = payload;

    // กำหนดช่วงเวลาปัจจุบัน (+7 วัน)
    const todayStart = getTodayStartAdd7().toDate(); // เริ่มต้นวันนี้ + 7 วัน
    const todayEnd = getTodayEndAdd7().toDate(); // สิ้นสุดวันนี้ + 7 วัน

    // ค้นหาข้อมูลสัญญาจากฐานข้อมูล
    const contractCode = await this.prisma.contract_code.findFirst({
      where: { id: Number(id) }, // แปลง ID เป็นตัวเลข
    });

    // ค้นหาข้อมูล JSON การจองแบบเต็ม
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

      const terminateDate = dayjs(nowDate).format('YYYY-MM-DD');

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

      // ปรับใหม่ ------------------------------------------
      // valueExtend

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

  /**
   * =====================================================================================
   * EDIT VERSION - แก้ไขเวอร์ชันการจอง
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับแก้ไขเวอร์ชันการจองที่มีอยู่
   * อัปเดตข้อมูลการจองทั้งแบบเต็มและแบบแถว
   * 
   * @param payload - ข้อมูลสำหรับแก้ไขเวอร์ชัน
   * @param id - ID ของเวอร์ชันการจอง
   * @param userId - ID ของผู้ใช้ที่ทำการแก้ไข
   * @returns Promise<any> - ผลลัพธ์การแก้ไขเวอร์ชัน
   * 
   * @description
   * - แก้ไขเวอร์ชันการจองที่มีอยู่
   * - อัปเดตข้อมูลการจองแบบเต็มและแบบแถว
   * - ตรวจสอบสถานะสัญญาและวันที่เริ่มต้น
   * - สร้างข้อมูลเงาและระยะเวลาเงา
   * - แยกข้อมูลการเข้าและออก
   * - บันทึกข้อมูลผู้อัปเดตและเวลาที่อัปเดต
   */
  async editVersion(payload: any, id: any, userId: any) {
    // แยกข้อมูลจาก payload
    const {
      flagFromTo, // ฟลากสำหรับการแปลงจาก-ถึง
      booking_full_json, // ข้อมูลการจองแบบเต็ม
      booking_row_json, // ข้อมูลการจองแบบแถว
      terminateDate, // วันที่สิ้นสุด
      fromDate, // วันที่เริ่มต้น
      toDate, // วันที่สิ้นสุด
    } = payload;
    
    // ค้นหาข้อมูลเวอร์ชันการจอง
    const bookingVersion = await this.prisma.booking_version.findFirst({
      where: {
        id: Number(id), // แปลง ID เป็นตัวเลข
      },
      include: {
        contract_code: true, // รวมข้อมูลสัญญา
        booking_full_json: true, // รวมข้อมูลการจองแบบเต็ม
        booking_row_json: true, // รวมข้อมูลการจองแบบแถว
      },
    });

    // ดึงข้อมูลวันที่เริ่มต้นสัญญา
    const startDate = bookingVersion?.contract_code?.contract_start_date;
    // ดึงข้อมูลสถานะการจัดการความจุ
    const status =
      bookingVersion?.contract_code?.status_capacity_request_management_id;

    // กำหนดวันที่ปัจจุบัน (+7 วัน)
    const nowDate = getTodayNowAdd7().toDate();

    // ตรวจสอบว่าสัญญาเริ่มต้นแล้วหรือไม่
    const hasContractStarted =
      getTodayNowAdd7(nowDate).isAfter(getTodayNowAdd7(startDate)) ||
      getTodayNowAdd7(nowDate).isSame(getTodayNowAdd7(startDate));

    // กำหนดโหมดวันและเดือน (term_type_id = 4 ใช้โหมด 1, อื่นๆ ใช้โหมด 2)
    const modeDayAndMonth =
      bookingVersion?.contract_code?.term_type_id === 4 ? 1 : 2;
    
    // สร้างข้อมูลระยะเวลาเงา
    const shadowPeriod = this.capacityMiddleService.genMD(
      fromDate,
      getTodayNowDDMMYYYYDfaultAdd7(toDate)
        .subtract(1, 'day')
        .format('DD/MM/YYYY'),
      modeDayAndMonth,
    );

    // แยกข้อมูลการเข้า (entry_exit_id = 1)
    const newEntry = booking_row_json.filter((f: any) => {
      return f?.entry_exit_id === 1;
    });

    // แยกข้อมูลการออก (entry_exit_id = 2)
    const newExit = booking_row_json.filter((f: any) => {
      return f?.entry_exit_id === 2;
    });

    // area_text

    // https://app.clickup.com/t/86erqt8g5
    const ckAreaDup = [...newEntry, ...newExit]?.map(
      (ar: any) => ar?.area_text,
    );
    const hasDuplicate = new Set(ckAreaDup).size !== ckAreaDup.length;
    // console.log('- ckAreaDup : ', ckAreaDup);
    if (hasDuplicate) {
      // console.log('ckAreaDup : ', ckAreaDup);
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Duplicate Contract Point found.',
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
            ref_contract_code_by_main_id: bookingVersion?.contract_code?.id,
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
              id: bookingVersion?.contract_code
                ?.status_capacity_request_management_process_id,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: bookingVersion?.contract_code
                ?.status_capacity_request_management_id,
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
      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });
      //
      // เอาเวลา
      // getTodayNowYYYYMMDDDfaultAdd7(fromDate).toDate()

      if (
        status === 2 &&
        getTodayNowDDMMYYYYDfault(fromDate).isSameOrBefore(getTodayNowAdd7())
      ) {
        console.log('tttt');
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
        try {
          await this.updateStatusCapacityRequestManagement(
            bookingVersion?.contract_code?.id,
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
      }
    }

    return bookingVersion;
  }

  /**
   * =====================================================================================
   * CAPACITY REQUEST MANAGEMENT DOWNLOAD - ดาวน์โหลดข้อมูลการจัดการความจุ
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับดาวน์โหลดข้อมูลการจัดการความจุในรูปแบบ Excel
   * แปลงข้อมูลจากฐานข้อมูลเป็นรูปแบบที่พร้อมสำหรับการส่งออก
   * 
   * @param id - ID ของเวอร์ชันการจอง
   * @returns Promise<any> - ข้อมูลการจัดการความจุที่พร้อมสำหรับการดาวน์โหลด
   * 
   * @description
   * - ดึงข้อมูลเวอร์ชันการจองจากฐานข้อมูล
   * - แปลงข้อมูล JSON ที่เก็บไว้เป็น object
   * - สร้างข้อมูล Shipper Info, Header Entry/Exit
   * - จัดรูปแบบข้อมูลสำหรับการส่งออกเป็น Excel
   * - รองรับการดาวน์โหลดข้อมูลการจองแบบเต็มและแบบแถว
   */
  async capacityRequestManagementDownload(id: any) {
    // ค้นหาข้อมูลเวอร์ชันการจองจากฐานข้อมูล
    const bookingVersion = await this.prisma.booking_version.findUnique({
      where: { id: Number(id) }, // แปลง ID เป็นตัวเลข
      include: {
        booking_full_json: true, // รวมข้อมูลการจองแบบเต็ม
        booking_row_json: true, // รวมข้อมูลการจองแบบแถว
      },
    });
    
    let newBK: any = null; // ตัวแปรสำหรับเก็บข้อมูลที่แปลงแล้ว
    newBK = bookingVersion;
    
    // แปลงข้อมูล JSON ใน booking_full_json เป็น object
    newBK['booking_full_json'] = await newBK?.booking_full_json.map(
      (e: any) => {
        const data_temp = JSON.parse(e['data_temp']); // แปลง JSON string เป็น object
        return { ...e, data_temp: data_temp };
      },
    );
    
    // แปลงข้อมูล JSON ใน booking_row_json เป็น object
    newBK['booking_row_json'] = await newBK?.booking_row_json.map((e: any) => {
      const data_temp = JSON.parse(e['data_temp']); // แปลง JSON string เป็น object
      return { ...e, data_temp: data_temp };
    });

    // ดึงข้อมูล Shipper Info จากข้อมูลการจองแบบเต็ม
    const shipperInfo =
      newBK['booking_full_json'][0]['data_temp']['shipperInfo'];

    // ดึงชื่อ Shipper
    const ShipperName = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]['Shipper Name'];
      })
      .find((item) => item !== undefined);
    
    // ดึงประเภทสัญญา
    const typeOfContract: any = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]['Type of Contract'];
      })
      .find((item) => item !== undefined);
    
    // ดึงรหัสสัญญา
    const ContractCode = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]['Contract Code'];
      })
      .find((item) => item !== undefined);

    // ดึงข้อมูล Header Entry สำหรับการจองรายวัน
    const headerEntryInfo1 =
      newBK['booking_full_json'][0]['data_temp']['headerEntry'][
        'Capacity Daily Booking (MMBTU/d)'
      ];

    // สร้างอาร์เรย์ของ Header Entry
    const headerEntryArr1 = Object.keys(headerEntryInfo1)
      .filter((key) => key !== 'key') // กรอง key ออก
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

  /**
   * =====================================================================================
   * HELPER METHODS - ฟังก์ชันช่วยเหลือ
   * =====================================================================================
   */

  /**
   * เขียนข้อมูลลงใน Response stream
   * @param res - Response object
   * @param s - ข้อมูลที่ต้องการเขียน
   */
  private w(res: Response, s: string) {
    res.write(s);
  }

  /**
   * แปลงข้อมูลเป็น JSON string
   * @param v - ข้อมูลที่ต้องการแปลง
   * @returns JSON string
   */
  private j(v: any) {
    return JSON.stringify(v);
  }

  /**
   * แปลงวันที่เป็นรูปแบบ ISO string
   * @param d - วันที่ที่ต้องการแปลง
   * @returns วันที่ในรูปแบบ ISO string (YYYY-MM-DDTHH:mm:ss.SSS[Z])
   */
  private fm(d: Date) {
    return dayjs(d).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
  }

  /**
   * =====================================================================================
   * STREAM GET PERIOD OLD - สตรีมข้อมูลช่วงเวลาแบบเก่า
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับส่งข้อมูลช่วงเวลาในรูปแบบ streaming
   * เพื่อลดการใช้หน่วยความจำและเพิ่มประสิทธิภาพการส่งข้อมูล
   * 
   * @param id - ID ของสัญญา
   * @param res - Response object สำหรับการส่งข้อมูล
   * @returns Promise<void>
   * 
   * @description
   * - ส่งผลลัพธ์ "เหมือน getPeriodOld" แต่สตรีม JSON เป็นชิ้นๆ
   * - ไม่ต้องแก้ฟังก์ชันฝั่งหน้าเว็บ (ยัง .map() ได้เหมือนเดิม)
   * - จำกัดจำนวนแถวสูงสุดเพื่อป้องกันการใช้งานหน่วยความจำเกิน
   * - ส่งข้อมูลเป็น JSON array แบบ streaming
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
  /**
   * =====================================================================================
   * GET PERIOD - ดึงข้อมูลช่วงเวลา
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับดึงข้อมูลช่วงเวลาการจัดการความจุ
   * ใช้การแบ่งหน้าข้อมูลเพื่อเพิ่มประสิทธิภาพ
   * 
   * @param id - ID ของสัญญา
   * @returns Promise<any[]> - ข้อมูลช่วงเวลาการจัดการความจุ
   * 
   * @description
   * - ดึงข้อมูลช่วงเวลาการจัดการความจุแบบแบ่งหน้า
   * - รวมข้อมูลพื้นที่ จุดความจุ และการปรับแต่ง
   * - จัดกลุ่มข้อมูลตามพื้นที่และจุดความจุ
   * - เพิ่มวันที่เริ่มต้นและสิ้นสุดให้กับข้อมูล
   * - รองรับการประมวลผลข้อมูลจำนวนมาก
   */
  async getPeriod(id: any) {
    // กำหนดขนาดหน้าข้อมูล (ปรับได้ตามความเหมาะสม)
    const pageSize = 2000; // หรือปรับตามเหมาะสม
    
    let resData = []; // ตัวแปรสำหรับเก็บข้อมูลผลลัพธ์
    let skip = 0; // ตัวแปรสำหรับข้ามข้อมูล
    let hasMore = true; // ตัวแปรสำหรับตรวจสอบว่ามีข้อมูลเพิ่มเติมหรือไม่
    
    console.log('get'); // แสดงสถานะการเริ่มต้น
    console.time('start'); // เริ่มจับเวลาการประมวลผล
    
    // วนลูปดึงข้อมูลแบบแบ่งหน้า
    while (hasMore) {
      // ดึงข้อมูลช่วงเวลาการจัดการความจุแบบแบ่งหน้า
      const resDataBatch =
        await this.prisma.capacity_detail_point_date.findMany({
          where: {
            period: { not: null }, // กรองข้อมูลที่มี period
            capacity_detail_point: {
              capacity_detail: {
                flag_use: true, // กรองข้อมูลที่ใช้งานอยู่
                contract_code_id: Number(id), // กรองตาม ID สัญญา
              },
            },
          },
          select: {
            path_id: true, // ID เส้นทาง
            id: true, // ID ข้อมูล
            date: true, // วันที่
            period: true, // ช่วงเวลา
            area_id: true, // ID พื้นที่
            value: true, // ค่า
            ck_comparea: true, // ตรวจสอบพื้นที่เปรียบเทียบ
            ckCompare: true, // ตรวจสอบการเปรียบเทียบ
            adjust: true, // การปรับแต่ง
            adjust_type: true, // ประเภทการปรับแต่ง
            area_nominal_capacity: true, // ความจุระบุของพื้นที่
            cals: true, // การคำนวณ
            release: true, // การปล่อย
            capacity_detail_point_id: true, // ID จุดความจุ
            area: {
              select: {
                id: true, // ID พื้นที่
                name: true, // ชื่อพื้นที่
                color: true, // สีพื้นที่
                entry_exit: {
                  select: {
                    name: true, // ชื่อจุดเข้า-ออก
                  },
                },
              },
            },
            capacity_detail_point: {
              select: {
                id: true, // ID จุดความจุ
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

  /**
   * =====================================================================================
   * DUPLICATE VERSION - สร้างเวอร์ชันใหม่จากการคัดลอก
   * =====================================================================================
   * 
   * ฟังก์ชันสำหรับสร้างเวอร์ชันใหม่จากการคัดลอกเวอร์ชันที่มีอยู่
   * ตรวจสอบเงื่อนไขและสร้างเวอร์ชันใหม่พร้อมข้อมูลที่เกี่ยวข้อง
   * 
   * @param id - ID ของเวอร์ชันการจองที่ต้องการคัดลอก
   * @param userId - ID ของผู้ใช้ที่ทำการคัดลอก
   * @returns Promise<any> - ผลลัพธ์การสร้างเวอร์ชันใหม่
   * 
   * @description
   * - คัดลอกเวอร์ชันการจองที่มีอยู่
   * - ตรวจสอบสถานะสัญญาและวันที่เริ่มต้น
   * - ปิดการใช้งานเวอร์ชันเก่าทั้งหมด
   * - สร้างเวอร์ชันใหม่พร้อมข้อมูลการจองแบบเต็มและแบบแถว
   * - บันทึกข้อมูลผู้สร้างและเวลาที่สร้าง
   */
  async duplicateVersion(id: any, userId: any) {
    // ค้นหาข้อมูลเวอร์ชันการจองที่ต้องการคัดลอก
    const bookingVersion = await this.prisma.booking_version.findFirst({
      where: {
        id: Number(id), // แปลง ID เป็นตัวเลข
      },
      include: {
        contract_code: true, // รวมข้อมูลสัญญา
        booking_full_json: true, // รวมข้อมูลการจองแบบเต็ม
        booking_row_json: true, // รวมข้อมูลการจองแบบแถว
      },
    });

    // ดึงข้อมูลวันที่เริ่มต้นสัญญา
    const startDate = bookingVersion?.contract_code?.contract_start_date;
    // ดึงข้อมูลสถานะการจัดการความจุ
    const status =
      bookingVersion?.contract_code?.status_capacity_request_management_id;

    // กำหนดวันที่ปัจจุบัน (+7 วัน)
    const nowDate = getTodayNowAdd7().toDate();

    // ตรวจสอบว่าสัญญาเริ่มต้นแล้วหรือไม่
    const hasContractStarted =
      dayjs(nowDate).isAfter(dayjs(startDate)) ||
      dayjs(nowDate).isSame(dayjs(startDate));

    // ตรวจสอบเงื่อนไขการคัดลอก
    if (status === 2 && hasContractStarted) {
      // สัญญาเริ่มต้นแล้วและมีสถานะอนุมัติ - ไม่สามารถคัดลอกได้
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'สัญญาเริ่มไปแล้ว duplicate ไม่ได้',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {
      // ปิดการใช้งานเวอร์ชันเก่าทั้งหมดของสัญญานี้
      await this.prisma.booking_version.updateMany({
        where: {
          contract_code_id: bookingVersion?.contract_code?.id,
        },
        data: {
          flag_use: false, // ปิดการใช้งาน
        },
      });

      // นับจำนวนเวอร์ชันที่มีอยู่เพื่อสร้างหมายเลขเวอร์ชันใหม่
      const checkContractCodeCheckLength =
        await this.prisma.booking_version.count({
          where: {
            contract_code_id: bookingVersion?.contract_code?.id,
          },
        });

      // สร้างเวอร์ชันใหม่
      const versId = await this.prisma.booking_version.create({
        data: {
          version: `v.${checkContractCodeCheckLength + 1}`, // สร้างหมายเลขเวอร์ชันใหม่
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
}
