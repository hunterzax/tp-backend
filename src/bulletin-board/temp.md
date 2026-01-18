import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx-js-style';
import * as XlsxPopulate from 'xlsx-populate';
import * as fs from 'fs';

import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import * as customParseFormat from 'dayjs/plugin/customParseFormat';
import * as isSameOrAfter from 'dayjs/plugin/isSameOrAfter';


import * as isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import { CapacityService } from 'src/capacity/capacity.service';
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class BulletinBoardService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheService: Cache,
    private readonly capacityService: CapacityService,
  ) {}

  // generateMonthArray(startDate: string, endDate: string): string[] {
  //   const starts = dayjs(startDate, 'DD/MM/YYYY', true);
  //   const ends = dayjs(endDate, 'DD/MM/YYYY', true);
  //   const start = dayjs(starts);
  //   const end = dayjs(ends);
  //   let result = [];
  //   let current = start.clone();

  //   // ลูปผ่านแต่ละเดือนเริ่มตั้งแต่ startDate จนถึง endDate
  //   while (current.isBefore(end) || current.isSame(end, 'month')) {
  //     result.push(current.format('DD/MM/YYYY'));
  //     current = current.add(1, 'month').startOf('month');
  //   }

  //   return result;
  // }
  
  generateMonthArray(startDate: string, endDate: string, fixDay: number): string[] {
    const starts = dayjs(startDate, 'DD/MM/YYYY', true);
    const ends = dayjs(endDate, 'DD/MM/YYYY', true);
    let result = [];
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
    const starts = dayjs(startDate, 'DD/MM/YYYY', true);
    const ends = dayjs(endDate, 'DD/MM/YYYY', true);
    let result = [];
    let current = starts.clone();
  
    while (current.isBefore(ends, 'day') || current.isSame(ends, 'day')) {
      result.push(current.format('DD/MM/YYYY'));
      current = current.add(1, 'day'); // เพิ่มทีละวัน
    }
    console.log(result);
    return result;
  }
  

  // adjustStartDate(startDate:any, fixDay:any) {
  //   const today = dayjs(); // วันที่ปัจจุบัน
  //   let start = dayjs(startDate, 'DD/MM/YYYY', true).date(fixDay); // ตั้งวันที่เป็น fixDay ตั้งแต่แรก
  
  //   // ถ้าวันที่ปัจจุบันเท่ากับหรือมากกว่า startDate ที่ fixDay แล้ว
  //   if (today.isSameOrAfter(start)) {
  //     // ขยับไปเดือนถัดไปและตั้งวันที่เป็น fixDay
  //     start = start.add(1, 'month').date(fixDay);
  
  //     // ตรวจสอบถ้าวันที่ fixDay ไม่มีในเดือนนั้น เช่น กุมภาพันธ์
  //     const daysInMonth = start.daysInMonth();
  //     start = start.date(Math.min(fixDay, daysInMonth)); // ตั้งเป็นวันสุดท้ายของเดือนถ้า fixDay ไม่มีในเดือนนั้น
  //   }
  
  //   return start.format('DD/MM/YYYY');
  // }
//  startDate ต้องกว่ากว่าวันที่ปัจจุบัน 1 วันเสมอ
  // ใช้กับ upload ด้วย
  
  adjustStartDate(startDate: any, fixDay: any) {
    const today = dayjs(); // วันที่ปัจจุบัน
    let start = dayjs(startDate, 'DD/MM/YYYY', true); // วันที่เริ่มต้นจาก input
  
    // ตรวจสอบจำนวนวันในเดือนของ startDate
    const daysInMonth = start.daysInMonth();
    console.log('fixDay : ', fixDay);
    console.log('daysInMonth : ', daysInMonth);
    // ตรวจสอบว่า fixDay อยู่ในเดือนของ startDate หรือไม่
    if (fixDay <= daysInMonth) {
      // ตั้งวันที่เป็น fixDay ในเดือนปัจจุบัน
      start = start.date(fixDay);
  
      // ถ้า today เกิน fixDay ให้เลื่อนไปเดือนถัดไป
      // if (today.isAfter(start)) {
      //   start = start.add(1, 'month');
      //   const nextDaysInMonth = start.daysInMonth();
      //   start = start.date(Math.min(fixDay, nextDaysInMonth));
      // }
    } else {
      // ถ้า fixDay ไม่มีในเดือนปัจจุบัน ให้เลื่อนไปวันสุดท้ายของเดือนถัดไป
      start = start.add(1, 'month');
      const nextDaysInMonth = start.daysInMonth();
      start = start.date(Math.min(fixDay, nextDaysInMonth));
    }
  
    return start.format('DD/MM/YYYY');
  }
  
  checkDateRange(startDate: string, endDate: string, file_period_mode: number, min: number, max: number): boolean {
    const starts = dayjs(startDate, 'DD/MM/YYYY', true);
    const ends = dayjs(endDate, 'DD/MM/YYYY', true);
    
    let diff;
    
    // คำนวณความแตกต่างตามโหมดที่กำหนด
    if (file_period_mode === 1) {
      diff = ends.diff(starts, 'day'); // คำนวณต่างกันเป็นจำนวนวัน
    } else if (file_period_mode === 2) {
      diff = ends.diff(starts, 'month'); // คำนวณต่างกันเป็นจำนวนเดือน
    } else if (file_period_mode === 3) {
      diff = ends.diff(starts, 'year'); // คำนวณต่างกันเป็นจำนวนปี
    } else {
      return false; // กรณี mode ไม่ตรงกับเงื่อนไขที่กำหนด
    }
    
    // ตรวจสอบความแตกต่างว่าอยู่ในช่วง min และ max หรือไม่
    return diff >= min && diff <= max;
  }
  
  

  async getGroupByIdAccount(id: any) {
    const resData = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(id),
          },
        },
        // user_type_id: 3
      },
    });
    if(!!!resData){
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'not have group',
          // error: 'Only Shipper',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {...resData, name: resData?.user_type_id !== 3 ? "xx" : resData?.name }
  }

  // http://10.100.101.15:8010/master/bulletin-board
  // async createExcelTemplate(payload: any, groupInfo: any, userId: any) {
  //   let { startDate, endDateDate, ContractCode, type } = payload;
  //   const todayStart = dayjs().startOf('day').add(7, 'hour').toDate(); // เวลาเริ่มต้นของวันนี้
  //   const todayEnd = dayjs().endOf('day').add(7, 'hour').toDate(); // เวลาสิ้นสุดของวันนี้
  //   const sDate = dayjs(startDate, 'DD/MM/YYYY', true).format("DD/MM/YYYY")
  //   const eDate = dayjs(endDateDate, 'DD/MM/YYYY', true).format("DD/MM/YYYY")
   
  //   const bookingTemplate = await this.prisma.booking_template.findFirst({
  //     where:{
  //       term_type_id: Number(type),
  //       start_date: {
  //         lte: todayEnd,
  //       },
  //       end_date: {
  //         gte: todayStart,
  //       },
  //     },
  //   })
  //   console.log('bookingTemplate : ', bookingTemplate);
  //   if(!!!bookingTemplate){
  //     throw new HttpException(
  //       {
  //         status: HttpStatus.BAD_REQUEST,
  //         error: 'booking template date not match',
  //       },
  //       HttpStatus.BAD_REQUEST,
  //     );
  //   }

  //   let checkMinMax = false

  //   checkMinMax = this.checkDateRange(startDate, endDateDate, bookingTemplate?.file_period_mode, bookingTemplate?.min, bookingTemplate?.max)

  //   if(!checkMinMax){
  //     throw new HttpException(
  //       {
  //         status: HttpStatus.BAD_REQUEST,
  //         error: 'Date is NOT match',
  //       },
  //       HttpStatus.BAD_REQUEST,
  //     );
  //   }

  //   let resultDate = null

  //   if(bookingTemplate?.file_start_date_mode === 1){
  //     resultDate = this.generateDailyArray(startDate, endDateDate);
  //   }

  //   if(bookingTemplate?.file_start_date_mode === 3){
  //     startDate = dayjs(startDate, 'DD/MM/YYYY', true).add(bookingTemplate?.todayday, "day").format("DD/MM/YYYY")
  //     resultDate = this.generateDailyArray(startDate, endDateDate);
  //   }

  //   if(bookingTemplate?.file_start_date_mode === 2){
  //     startDate = this.adjustStartDate(startDate, bookingTemplate?.fixdayday)
  //     resultDate = this.generateMonthArray(startDate, endDateDate, bookingTemplate?.fixdayday);
  //   }
    

  //   const typeOfContract =
  //     type === '1'
  //       ? 'LONG'
  //       : type === '2'
  //         ? 'MEDIUM'
  //         : type === '3'
  //           ? 'SHORT_FIRM'
  //           : type === '4'
  //             ? 'SHORT_NON_FIRM'
  //             : 'error type';
  //   const ShipperName = groupInfo?.name || ''
  //   // const ShipperName = '';

    
  //   const capacityDailyBookingArrayMMB = [
  //     'Capacity Daily Booking (MMBTU/d)',
  //     ...Array(resultDate.length - 1).fill(''),
  //   ];
  //   const maximumHourBookingMMBArray = [
  //     'Maximum Hour Booking (MMBTU/h)',
  //     ...Array(resultDate.length - 1).fill(''),
  //   ];
  //   const capacityDailyBookingMMsArray = [
  //     'Capacity Daily Booking (MMscfd)',
  //     ...Array(resultDate.length - 1).fill(''),
  //   ];
  //   const maximumHourBookingMMsArray = [
  //     'Maximum Hour Booking (MMscfh)',
  //     ...Array(resultDate.length - 1).fill(''),
  //   ];

  //   // คำนวณจำนวนเซลล์ทั้งหมดในแถวที่ 6 (รวม resultDate ทั้งหมด 4 กลุ่ม)
  //   const totalCellsInRow6 = 33 + resultDate.length * 4;

  //   // เพิ่ม "" ให้ครบตามจำนวนของแถวที่ 6 (เรามี startDate และ endDateDate ที่แถวที่ 7 แล้ว)
  //   const row7 = Array(totalCellsInRow6 - 33).fill('');
  //   const row8 = Array(totalCellsInRow6 - 33).fill(0);
  //   // ----

  //   const capacityDailyBookingArrayMMBExit = [
  //     'Capacity Daily Booking (MMBTU/d)',
  //     ...Array(resultDate.length - 1).fill(''),
  //   ];
  //   const maximumHourBookingMMBArrayExit = [
  //     'Maximum Hour Booking (MMBTU/h)',
  //     ...Array(resultDate.length - 1).fill(''),
  //   ];

  //   // คำนวณจำนวนเซลล์ทั้งหมดในแถวที่ 6 (รวม resultDate ทั้งหมด 2 กลุ่ม)
  //   const totalCellsInRow12 = 33 + resultDate.length * 2;

  //   // เพิ่ม "" ให้ครบตามจำนวนของแถวที่ 6 (เรามี startDate และ endDateDate ที่แถวที่ 7 แล้ว)
  //   const row13 = Array(totalCellsInRow12 - 33).fill('');
  //   const row14 = Array(totalCellsInRow12 - 33).fill(0);

  //   const data = [
  //     [], // Row 0
  //     ['Shipper Name', 'Type of Contract', 'Contract Code'], // Row 1
  //     [ShipperName, typeOfContract, ContractCode], // Row 2
  //     [], // Row 3 (empty row)
  //     [
  //       'Entry',
  //       null,
  //       null,
  //       null,
  //       null,
  //       'Period',
  //       '',
  //       ...capacityDailyBookingArrayMMB,
  //       ...maximumHourBookingMMBArray,
  //       ...capacityDailyBookingMMsArray,
  //       ...maximumHourBookingMMsArray,
  //     ],
  //     [
  //       '',
  //       'Pressure Range',
  //       '',
  //       'Temperature Range',
  //       '',
  //       'From',
  //       'To',
  //       ...resultDate,
  //       ...resultDate,
  //       ...resultDate,
  //       ...resultDate,
  //     ],
  //     [
  //       '',
  //       'Min',
  //       'Max',
  //       'Min',
  //       'Max',
  //       '',
  //       '',
  //     ],
  //     [
  //       '',
  //       '',
  //       '',
  //       '',
  //       '',
  //       sDate,
  //       eDate,
  //       ...row7,
  //     ],
  //     [
  //       'Sum Entry',
  //       '',
  //       '',
  //       '',
  //       '',
  //       '',
  //       '',
  //       ...row8,
  //     ],
  //     [],
  //     [
  //       'Exit',
  //       null,
  //       null,
  //       null,
  //       null,
  //       'Period',
  //       '',
  //       ...capacityDailyBookingArrayMMBExit,
  //       ...maximumHourBookingMMBArrayExit,
  //     ],
  //     [
  //       '',
  //       'Pressure Range',
  //       '',
  //       'Temperature Range',
  //       '',
  //       'From',
  //       'To',
  //       ...resultDate,
  //       ...resultDate,
  //     ],
  //     [
  //       '',
  //       'Min',
  //       'Max',
  //       'Min',
  //       'Max',
  //       '',
  //       '',
  //     ],
  //     [
  //       '',
  //       '',
  //       '',
  //       '',
  //       '',
  //       sDate,
  //       eDate,
  //       ...row13,
  //     ],
  //     [
  //       'Sum Exit',
  //       '',
  //       '',
  //       '',
  //       '',
  //       '',
  //       '',
  //       ...row14,
  //     ],
  //   ];

  //   // สร้าง workbook และ worksheet
  //   const worksheet = XLSX.utils.aoa_to_sheet(data); // สร้าง sheet จาก array ของ array
  //   const workbook = XLSX.utils.book_new(); // สร้าง workbook ใหม่
  //   XLSX.utils.book_append_sheet(workbook, worksheet, typeOfContract); // เพิ่ม sheet ลงใน workbook

  //   // Merge cells สำหรับ header ที่มีการรวม (merge ข้ามคอลัมน์และแถว)
  //   worksheet['!merges'] = [
  //     // Merge คอลัมน์สำหรับ "Pressure Range" และ "Temperature Range"
  //     { s: { r: 5, c: 1 }, e: { r: 5, c: 2 } }, // Merge 'Pressure Range' header (c:6 to c:7)
  //     { s: { r: 5, c: 3 }, e: { r: 5, c: 4 } }, // Merge 'Temperature Range' header (c:8 to c:9)

  //     // period
  //     { s: { r: 4, c: 5 }, e: { r: 4, c: 6 } },
  //     // form to
  //     { s: { r: 5, c: 5 }, e: { r: 6, c: 5 } },
  //     { s: { r: 5, c: 6 }, e: { r: 6, c: 6 } },
  //      // // Head
  //      { s: { r: 4, c: 0 }, e: { r: 6, c: 0 } },

  //     // Entry Merge dynamic สำหรับ capacityDailyBookingArrayMMB
  //     { s: { r: 4, c: 7 }, e: { r: 4, c: 7 + resultDate.length - 1 } },

  //     // Entry Merge dynamic สำหรับ maximumHourBookingMMBArray
  //     {
  //       s: { r: 4, c: 7 + resultDate.length },
  //       e: { r: 4, c: 7 + resultDate.length * 2 - 1 },
  //     },

  //     // Entry Merge dynamic สำหรับ capacityDailyBookingMMsArray
  //     {
  //       s: { r: 4, c: 7 + resultDate.length * 2 },
  //       e: { r: 4, c: 7 + resultDate.length * 3 - 1 },
  //     },

  //     // Entry Merge dynamic สำหรับ maximumHourBookingMMsArray
  //     {
  //       s: { r: 4, c: 7 + resultDate.length * 3 },
  //       e: { r: 4, c: 7 + resultDate.length * 4 - 1 },
  //     },

  //     //------

  //     // Merge คอลัมน์สำหรับ "Pressure Range" และ "Temperature Range"
  //     { s: { r: 11, c: 1 }, e: { r: 11, c: 2 } }, // Merge 'Pressure Range' header (c:6 to c:7)
  //     { s: { r: 11, c: 3 }, e: { r: 11, c: 4 } }, // Merge 'Temperature Range' header (c:8 to c:9)

  //     // // period
  //     { s: { r: 10, c: 5 }, e: { r: 10, c: 6 } },
  //     // // form to
  //     { s: { r: 11, c: 5 }, e: { r: 12, c: 5 } },
  //     { s: { r: 11, c: 6 }, e: { r: 12, c: 6 } },
  //     // // Head
  //     { s: { r: 10, c: 0 }, e: { r: 12, c: 0 } },
     

  //     // Entry Merge dynamic สำหรับ capacityDailyBookingArrayMMBExit
  //     { s: { r: 10, c: 7 }, e: { r: 10, c: 7 + resultDate.length - 1 } },

  //     // Entry Merge dynamic สำหรับ maximumHourBookingMMBArrayExit
  //     {
  //       s: { r: 10, c: 7 + resultDate.length },
  //       e: { r: 10, c: 7 + resultDate.length * 2 - 1 },
  //     },
  //   ];

  //   // Merge cells สำหรับ resultDate กับ row อันล่าง
  //   const resultDateCount = resultDate.length;

  //   for (let i = 0; i < resultDateCount * 4; i++) {
  //     const startColumnIndex = 7 + i;

  //     worksheet['!merges'].push({
  //       s: { r: 5, c: startColumnIndex }, // จุดเริ่มต้นการ merge จากแถวที่ 5
  //       e: { r: 6, c: startColumnIndex }, // จุดสิ้นสุดการ merge ในแถวที่ 6
  //     });
  //   }
  //   for (let i = 0; i < resultDateCount * 2; i++) {
  //     const startColumnIndex = 7 + i;

  //     worksheet['!merges'].push({
  //       s: { r: 11, c: startColumnIndex }, // จุดเริ่มต้นการ merge จากแถวที่ 11
  //       e: { r: 12, c: startColumnIndex }, // จุดสิ้นสุดการ merge ในแถวที่ 12
  //     });
  //   }


    
  //   Object.keys(worksheet).forEach((cell) => {
  //     const rowNumber = parseInt(cell.replace(/[^0-9]/g, '')); // ดึงเลขแถวออกมา
  //     const columnLetter = cell.replace(/[0-9]/g, '');
      

  //     if (
  //       worksheet[cell] &&
  //       typeof worksheet[cell] === 'object' &&
  //       cell[0] !== '!'
  //     ) {
  //       // ถ้าเป็นแถวที่ 3, 8, หรือ 14 จะไม่ใช้ตัวหนา
  //       if (rowNumber === 3 || rowNumber === 8 || rowNumber === 14) {
  //         worksheet[cell].s = {
  //           border: {
  //             top: { style: 'thin' },
  //             left: { style: 'thin' },
  //             bottom: { style: 'thin' },
  //             right: { style: 'thin' },
  //           },
  //           alignment: {
  //             horizontal: 'center', // จัดกลางแนวนอน
  //             vertical: 'center', // จัดกลางแนวตั้ง
  //             wrapText: true,
  //           },
  //         };
  //       } else {
  //         // สำหรับแถวอื่น ๆ ใช้สไตล์ตัวหนา
  //         worksheet[cell].s = {
  //           border: {
  //             top: { style: 'thin' },
  //             left: { style: 'thin' },
  //             bottom: { style: 'thin' },
  //             right: { style: 'thin' },
  //           },
  //           alignment: {
  //             horizontal: 'center', // จัดกลางแนวนอน
  //             vertical: 'center', // จัดกลางแนวตั้ง
  //             wrapText: true,
  //           },
  //           font: {
  //             bold: true, // ทำให้ข้อความในเซลล์เป็นตัวหนา
  //           },
  //         };
  //       }


  //       if (
  //         rowNumber === 6 &&
  //         columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
  //         columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
  //       ) {
  //         worksheet[cell].s.font = {
  //           color: { rgb: 'FF0000' },
  //           bold: true,
  //         };
  //       }

  //       if (rowNumber === 6 && columnLetter >= 'AA' && columnLetter <= 'AG') {
  //         worksheet[cell].s.font = {
  //           color: { rgb: 'FF0000' }, // เปลี่ยนสีข้อความเป็นสีแดง
  //           bold: true,
  //         };
  //       }

  //       if (
  //         rowNumber === 7 &&
  //         columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
  //         columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
  //       ) {
  //         worksheet[cell].s.font = {
  //           color: { rgb: 'FF0000' }, // เปลี่ยนสีข้อความเป็นสีแดง
  //           bold: true,
  //         };
  //       }

  //       if (rowNumber === 7 && columnLetter >= 'AA' && columnLetter <= 'AG') {
  //         worksheet[cell].s.font = {
  //           color: { rgb: 'FF0000' },
  //           bold: true,
  //         };
  //       }

  //       if (
  //         rowNumber === 12 &&
  //         columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
  //         columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
  //       ) {
  //         worksheet[cell].s.font = {
  //           color: { rgb: 'FF0000' },
  //           bold: true,
  //         };
  //       }

  //       if (
  //         rowNumber === 13 &&
  //         columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
  //         columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
  //       ) {
  //         worksheet[cell].s.font = {
  //           color: { rgb: 'FF0000' },
  //           bold: true,
  //         };
  //       }

  //       // แปลงค่า worksheet[cell].v เป็นสตริงในรูปแบบ 'DD/MM/YYYY'
  //       const cellDate = worksheet[cell].v ? worksheet[cell].v.toString() : '';
  //       if (resultDate.includes(cellDate)) {
  //         worksheet[cell].s = worksheet[cell].s || {};
  //         worksheet[cell].s = {
  //           fill: {
  //             patternType: 'solid',
  //             fgColor: { rgb: '92D04F' },
  //           },
  //           font: {
  //             color: { rgb: 'FF0000' },
  //             bold: true,
  //           },
  //           border: {
  //             top: { style: 'thin' },
  //             left: { style: 'thin' },
  //             bottom: { style: 'thin' },
  //             right: { style: 'thin' },
  //           },
  //           alignment: {
  //             horizontal: 'center',
  //             vertical: 'center',
  //             wrapText: true,
  //           },
  //         };
  //       }
  //     }
  //   });

  //   const excelBuffer = XLSX.write(workbook, {
  //     type: 'buffer',
  //     bookType: 'xlsx',
  //   });

  //   const times = dayjs(
  //     dayjs(dayjs().tz('Asia/Bangkok').format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'))
  //       .tz('Asia/Bangkok')
  //       .toDate(),
  //   ).format('YYYYMMDDHHmmss');

  //   // ส่ง buffer กลับไปเพื่อให้ controller สามารถใช้งานต่อไปได้
  //   return { excelBuffer, typeOfContract: `${times}_${typeOfContract}` };
  // }
  async createExcelTemplateOld(payload: any, groupInfo: any, userId: any) {
    let { startDate, endDateDate, ContractCode, type } = payload;
    const todayStart = dayjs().startOf('day').add(7, 'hour').toDate(); // เวลาเริ่มต้นของวันนี้
    const todayEnd = dayjs().endOf('day').add(7, 'hour').toDate(); // เวลาสิ้นสุดของวันนี้
    const sDate = dayjs(startDate, 'DD/MM/YYYY', true).format("DD/MM/YYYY")
    const eDate = dayjs(endDateDate, 'DD/MM/YYYY', true).format("DD/MM/YYYY")
    // console.log(payload);
    // console.log(groupInfo);
    // console.log(userId);
    // สร้างข้อมูลตัวอย่างในรูปแบบของ sheet
    // const startDate = '01/02/2024'
    // const endDateDate = '03/04/2024'
    // const ContractCode = 'AAs'
    // http://10.100.101.15:8010/master/bulletin-board?startDate=01%2F10%2F2024&endDateDate=03%2F04%2F2025&ContractCode=Con-01&type=1
    // http://10.100.101.15:8010/master/bulletin-board?startDate=08/12/2024&endDateDate=03/04/2025&ContractCode=Con-01&type=1
    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where:{
        term_type_id: Number(type),
        start_date: {
          lte: todayEnd,
        },
        end_date: {
          gte: todayStart,
        },
      },
    })
    console.log('bookingTemplate : ', bookingTemplate);
    if(!!!bookingTemplate){
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'booking template date not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // file_start_date_mode
    // min
    // max

    // const temp = {
    //   id: 5,
    //   file_period: null,
    //   file_period_mode: 1,  // 1 = วัน, 2 = เดือน, 3 = ปี
    //   file_start_date_mode: 2,  // 1 = every day, 2 = fix day, 3 = to day+
    //   fixdayday: 10,
    //   todayday: null,
    //   start_date: 2024-10-01T00:00:00.000Z,
    //   end_date: 2025-10-10T00:00:00.000Z,
    //   create_date: 2024-10-31T10:31:29.996Z,
    //   update_date: 2024-10-31T10:31:46.472Z,
    //   create_date_num: 1730345489,
    //   update_date_num: 1730345506,
    //   create_by: 1,
    //   update_by: 1,
    //   active: null,
    //   term_type_id: 1,
    //   shadow_time: 3,
    //   shadow_period: 5,
    //   min: 1,
    //   max: 3
    // }

    let checkMinMax = false

    checkMinMax = this.checkDateRange(startDate, endDateDate, bookingTemplate?.file_period_mode, bookingTemplate?.min, bookingTemplate?.max)

    if(!checkMinMax){
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Date is NOT match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let resultDate = null

    if(bookingTemplate?.file_start_date_mode === 1){
      resultDate = this.generateDailyArray(startDate, endDateDate);
    }

    if(bookingTemplate?.file_start_date_mode === 3){
      startDate = dayjs(startDate, 'DD/MM/YYYY', true).add(bookingTemplate?.todayday, "day").format("DD/MM/YYYY")
      resultDate = this.generateDailyArray(startDate, endDateDate);
    }

    if(bookingTemplate?.file_start_date_mode === 2){
      startDate = this.adjustStartDate(startDate, bookingTemplate?.fixdayday)
      resultDate = this.generateMonthArray(startDate, endDateDate, bookingTemplate?.fixdayday);
    }
    

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
    const ShipperName = groupInfo?.name || ''

    
    const capacityDailyBookingArrayMMB = [
      'Capacity Daily Booking (MMBTU/d)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const maximumHourBookingMMBArray = [
      'Maximum Hour Booking (MMBTU/h)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const capacityDailyBookingMMsArray = [
      'Capacity Daily Booking (MMscfd)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const maximumHourBookingMMsArray = [
      'Maximum Hour Booking (MMscfh)',
      ...Array(resultDate.length - 1).fill(''),
    ];

    // คำนวณจำนวนเซลล์ทั้งหมดในแถวที่ 6 (รวม resultDate ทั้งหมด 4 กลุ่ม)
    const totalCellsInRow6 = 33 + resultDate.length * 4;

    // เพิ่ม "" ให้ครบตามจำนวนของแถวที่ 6 (เรามี startDate และ endDateDate ที่แถวที่ 7 แล้ว)
    const row7 = Array(totalCellsInRow6 - 33).fill('');
    const row8 = Array(totalCellsInRow6 - 33).fill(0);
    // ----

    const capacityDailyBookingArrayMMBExit = [
      'Capacity Daily Booking (MMBTU/d)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const maximumHourBookingMMBArrayExit = [
      'Maximum Hour Booking (MMBTU/h)',
      ...Array(resultDate.length - 1).fill(''),
    ];

    // คำนวณจำนวนเซลล์ทั้งหมดในแถวที่ 6 (รวม resultDate ทั้งหมด 2 กลุ่ม)
    const totalCellsInRow12 = 33 + resultDate.length * 2;

    // เพิ่ม "" ให้ครบตามจำนวนของแถวที่ 6 (เรามี startDate และ endDateDate ที่แถวที่ 7 แล้ว)
    const row13 = Array(totalCellsInRow12 - 33).fill('');
    const row14 = Array(totalCellsInRow12 - 33).fill(0);

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
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
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
        'Zone',
        'Area',
        'Sub Area',
        '',
        'Entry Meter ID',
        'Entry Point',
        'New Connection?',
        'Pressure Range',
        '',
        'Temperature Range',
        '',
        'GCV Range',
        '',
        'WI Range',
        '',
        'C2+',
        '',
        'CO2',
        '',
        'O2',
        '',
        'N2',
        '',
        'H2S',
        '',
        'Total S',
        '',
        'Hg',
        '',
        'H2O',
        '',
        'HC Dew Point',
        '',
        'From',
        'To',
        ...resultDate,
        ...resultDate,
        ...resultDate,
        ...resultDate,
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        'Min',
        'Max',
        '',
        '',
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
        '',
        '',
        '',
        '',
        '',
        '',
        sDate,
        eDate,
        ...row7,
      ],
      [
        'Sum Entry',
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
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ...row8,
      ],
      [],
      [
        'Exit',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
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
        'Zone',
        'Area',
        'Sub Area',
        'Block Valve',
        'Exit Meter ID',
        'Entry Point',
        'New Connection?',
        'Pressure Range',
        '',
        'Temperature Range',
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
        'Type',
        'From',
        'To',
        ...resultDate,
        ...resultDate,
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Min',
        'Max',
        'Min',
        'Max',
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
        '',
        '',
        '',
        '',
        '',
        '',
        sDate,
        eDate,
        ...row13,
      ],
      [
        'Sum Exit',
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
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ...row14,
      ],
    ];

    // สร้าง workbook และ worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(data); // สร้าง sheet จาก array ของ array
    const workbook = XLSX.utils.book_new(); // สร้าง workbook ใหม่
    XLSX.utils.book_append_sheet(workbook, worksheet, typeOfContract); // เพิ่ม sheet ลงใน workbook

    // Merge cells สำหรับ header ที่มีการรวม (merge ข้ามคอลัมน์และแถว)
    worksheet['!merges'] = [
      // Merge คอลัมน์สำหรับ "Pressure Range" และ "Temperature Range"
      { s: { r: 5, c: 7 }, e: { r: 5, c: 8 } }, // Merge 'Pressure Range' header (c:6 to c:7)
      { s: { r: 5, c: 9 }, e: { r: 5, c: 10 } }, // Merge 'Temperature Range' header (c:8 to c:9)
      { s: { r: 5, c: 11 }, e: { r: 5, c: 12 } }, // Merge 'GCV Range' header (c:10 to c:11)
      { s: { r: 5, c: 13 }, e: { r: 5, c: 14 } }, // Merge 'WI Range' header (c:12 to c:13)
      { s: { r: 5, c: 15 }, e: { r: 5, c: 16 } },
      { s: { r: 5, c: 17 }, e: { r: 5, c: 18 } },
      { s: { r: 5, c: 19 }, e: { r: 5, c: 20 } },
      { s: { r: 5, c: 21 }, e: { r: 5, c: 22 } },
      { s: { r: 5, c: 23 }, e: { r: 5, c: 24 } },
      { s: { r: 5, c: 25 }, e: { r: 5, c: 26 } },
      { s: { r: 5, c: 27 }, e: { r: 5, c: 28 } },
      { s: { r: 5, c: 29 }, e: { r: 5, c: 30 } },
      { s: { r: 5, c: 31 }, e: { r: 5, c: 32 } },

      // Merge แถวสำหรับ "Zone" ที่รวมหลายแถว
      { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } }, // Merge 'Zone' row header (r:4 to r:5)
      { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } }, // Merge 'Area' row header (r:4 to r:5)
      { s: { r: 5, c: 2 }, e: { r: 6, c: 2 } }, // Merge 'Sub Area' row header (r:4 to r:5)
      { s: { r: 5, c: 3 }, e: { r: 6, c: 3 } }, // Merge empty column row header (r:4 to r:5)
      { s: { r: 5, c: 4 }, e: { r: 6, c: 4 } }, // Merge 'Entry Meter ID' row header (r:4 to r:5)
      { s: { r: 5, c: 5 }, e: { r: 6, c: 5 } }, // Merge 'Entry Point?' row header (r:4 to r:5)
      { s: { r: 5, c: 6 }, e: { r: 6, c: 6 } }, // Merge 'New Connection?' row header (r:4 to r:5)

      // period
      { s: { r: 4, c: 33 }, e: { r: 4, c: 34 } },
      // form to
      { s: { r: 5, c: 33 }, e: { r: 6, c: 33 } },
      { s: { r: 5, c: 34 }, e: { r: 6, c: 34 } },

      // Entry Merge dynamic สำหรับ capacityDailyBookingArrayMMB
      { s: { r: 4, c: 35 }, e: { r: 4, c: 35 + resultDate.length - 1 } },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMBArray
      {
        s: { r: 4, c: 35 + resultDate.length },
        e: { r: 4, c: 35 + resultDate.length * 2 - 1 },
      },

      // Entry Merge dynamic สำหรับ capacityDailyBookingMMsArray
      {
        s: { r: 4, c: 35 + resultDate.length * 2 },
        e: { r: 4, c: 35 + resultDate.length * 3 - 1 },
      },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMsArray
      {
        s: { r: 4, c: 35 + resultDate.length * 3 },
        e: { r: 4, c: 35 + resultDate.length * 4 - 1 },
      },

      //------

      // Merge คอลัมน์สำหรับ "Pressure Range" และ "Temperature Range"
      { s: { r: 11, c: 7 }, e: { r: 11, c: 8 } }, // Merge 'Pressure Range' header (c:6 to c:7)
      { s: { r: 11, c: 9 }, e: { r: 11, c: 10 } }, // Merge 'Temperature Range' header (c:8 to c:9)
      { s: { r: 11, c: 11 }, e: { r: 12, c: 11 } },
      { s: { r: 11, c: 12 }, e: { r: 12, c: 12 } },
      { s: { r: 11, c: 13 }, e: { r: 12, c: 13 } },
      { s: { r: 11, c: 14 }, e: { r: 12, c: 14 } },
      { s: { r: 11, c: 15 }, e: { r: 12, c: 15 } },
      { s: { r: 11, c: 16 }, e: { r: 12, c: 16 } },
      { s: { r: 11, c: 17 }, e: { r: 12, c: 17 } },
      { s: { r: 11, c: 18 }, e: { r: 12, c: 18 } },
      { s: { r: 11, c: 19 }, e: { r: 12, c: 19 } },
      { s: { r: 11, c: 20 }, e: { r: 12, c: 20 } },
      { s: { r: 11, c: 21 }, e: { r: 12, c: 21 } },
      { s: { r: 11, c: 22 }, e: { r: 12, c: 22 } },
      { s: { r: 11, c: 23 }, e: { r: 12, c: 23 } },
      { s: { r: 11, c: 24 }, e: { r: 12, c: 24 } },
      { s: { r: 11, c: 25 }, e: { r: 12, c: 25 } },
      { s: { r: 11, c: 26 }, e: { r: 12, c: 26 } },
      { s: { r: 11, c: 27 }, e: { r: 12, c: 27 } },
      { s: { r: 11, c: 28 }, e: { r: 12, c: 28 } },
      { s: { r: 11, c: 29 }, e: { r: 12, c: 29 } },
      { s: { r: 11, c: 30 }, e: { r: 12, c: 30 } },
      { s: { r: 11, c: 31 }, e: { r: 12, c: 31 } },
      { s: { r: 11, c: 32 }, e: { r: 12, c: 32 } },

      // Merge แถวสำหรับ "Zone" ที่รวมหลายแถว
      { s: { r: 11, c: 0 }, e: { r: 12, c: 0 } }, // Merge 'Zone' row header (r:4 to r:5)
      { s: { r: 11, c: 1 }, e: { r: 12, c: 1 } }, // Merge 'Area' row header (r:4 to r:5)
      { s: { r: 11, c: 2 }, e: { r: 12, c: 2 } }, // Merge 'Sub Area' row header (r:4 to r:5)
      { s: { r: 11, c: 3 }, e: { r: 12, c: 3 } }, // Merge empty column row header (r:4 to r:5)
      { s: { r: 11, c: 4 }, e: { r: 12, c: 4 } }, // Merge 'Entry Meter ID' row header (r:4 to r:5)
      { s: { r: 11, c: 5 }, e: { r: 12, c: 5 } }, // Merge 'Entry Point?' row header (r:4 to r:5)
      { s: { r: 11, c: 6 }, e: { r: 12, c: 6 } }, // Merge 'New Connection?' row header (r:4 to r:5)

      // // period
      { s: { r: 10, c: 33 }, e: { r: 10, c: 34 } },
      // // form to
      { s: { r: 11, c: 33 }, e: { r: 12, c: 33 } },
      { s: { r: 11, c: 34 }, e: { r: 12, c: 34 } },

      // Entry Merge dynamic สำหรับ capacityDailyBookingArrayMMBExit
      { s: { r: 10, c: 35 }, e: { r: 10, c: 35 + resultDate.length - 1 } },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMBArrayExit
      {
        s: { r: 10, c: 35 + resultDate.length },
        e: { r: 10, c: 35 + resultDate.length * 2 - 1 },
      },
    ];

    // Merge cells สำหรับ resultDate กับ row อันล่าง
    const resultDateCount = resultDate.length;

    for (let i = 0; i < resultDateCount * 4; i++) {
      const startColumnIndex = 35 + i;

      worksheet['!merges'].push({
        s: { r: 5, c: startColumnIndex }, // จุดเริ่มต้นการ merge จากแถวที่ 5
        e: { r: 6, c: startColumnIndex }, // จุดสิ้นสุดการ merge ในแถวที่ 6
      });
    }
    for (let i = 0; i < resultDateCount * 2; i++) {
      const startColumnIndex = 35 + i;

      worksheet['!merges'].push({
        s: { r: 11, c: startColumnIndex }, // จุดเริ่มต้นการ merge จากแถวที่ 11
        e: { r: 12, c: startColumnIndex }, // จุดสิ้นสุดการ merge ในแถวที่ 12
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
          (rowNumber === 2 && cell[0] === 'B') ||
          ((rowNumber === 6 || rowNumber === 7) && cell[0] === 'B') ||
          ((rowNumber === 12 || rowNumber === 13) && cell[0] === 'B')
        ) {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'FFFFCB' },
          };
        }
        if (rowNumber === 3 && cell[0] === 'B') {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'FBD4B4' },
          };
        }
        if ((rowNumber === 6 || rowNumber === 7) && cell[0] === 'D') {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'A5A5A5' },
          };
        }

        if (
          rowNumber === 12 &&
          columnLetter.charCodeAt(0) >= 'L'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'Z'.charCodeAt(0)
        ) {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'A5A5A5' },
          };
        }

        if (rowNumber === 12 && columnLetter >= 'AA' && columnLetter <= 'AF') {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'A5A5A5' },
          };
        }

        if (
          rowNumber === 6 &&
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'Z'.charCodeAt(0)
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
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'Z'.charCodeAt(0)
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
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'K'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        if (
          rowNumber === 13 &&
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'K'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        // แปลงค่า worksheet[cell].v เป็นสตริงในรูปแบบ 'DD/MM/YYYY'
        const cellDate = worksheet[cell].v ? worksheet[cell].v.toString() : '';
        if (resultDate.includes(cellDate) && columnLetter >= 'AI') {
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

    // เขียน workbook เป็นไฟล์ Excel (ในรูปแบบ buffer)
    // http://10.100.101.15:8010/master/bulletin-board?startDate=28/10/2024&endDateDate=29/12/3025&ContractCode=test&type=3
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    const times = dayjs(
      dayjs(dayjs().tz('Asia/Bangkok').format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'))
        .tz('Asia/Bangkok')
        .toDate(),
    ).format('YYYYMMDDHHmmss');

    // ส่ง buffer กลับไปเพื่อให้ controller สามารถใช้งานต่อไปได้
    return { excelBuffer, typeOfContract: `${times}_${typeOfContract}` };
  }

  async createExcelTemplateNew(payload: any, groupInfo: any, userId: any) {
    let { startDate, endDateDate, ContractCode, type } = payload;
    const todayStart = dayjs().startOf('day').add(7, 'hour').toDate(); // เวลาเริ่มต้นของวันนี้
    const todayEnd = dayjs().endOf('day').add(7, 'hour').toDate(); // เวลาสิ้นสุดของวันนี้
    const sDate = dayjs(startDate, 'DD/MM/YYYY', true).format("DD/MM/YYYY")
    const eDate = dayjs(endDateDate, 'DD/MM/YYYY', true).format("DD/MM/YYYY")
    
    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where:{
        term_type_id: Number(type),
        start_date: {
          lte: todayEnd,
        },
        end_date: {
          gte: todayStart,
        },
      },
    })
    if(!!!bookingTemplate){
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'booking template date not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let checkMinMax = false

    checkMinMax = this.checkDateRange(startDate, endDateDate, bookingTemplate?.file_period_mode, bookingTemplate?.min, bookingTemplate?.max)

    if(!checkMinMax){
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Date is NOT match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let resultDate = null

    if(bookingTemplate?.file_start_date_mode === 1){
      resultDate = this.generateDailyArray(startDate, endDateDate);
    }

    if(bookingTemplate?.file_start_date_mode === 3){
      startDate = dayjs(startDate, 'DD/MM/YYYY', true).add(bookingTemplate?.todayday, "day").format("DD/MM/YYYY")
      resultDate = this.generateDailyArray(startDate, endDateDate);
    }

    if(bookingTemplate?.file_start_date_mode === 2){
      startDate = this.adjustStartDate(startDate, bookingTemplate?.fixdayday)
      resultDate = this.generateMonthArray(startDate, endDateDate, bookingTemplate?.fixdayday);
    }
    

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
    const ShipperName = groupInfo?.name || ''

    
    const capacityDailyBookingArrayMMB = [
      'Capacity Daily Booking (MMBTU/d)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const maximumHourBookingMMBArray = [
      'Maximum Hour Booking (MMBTU/h)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const capacityDailyBookingMMsArray = [
      'Capacity Daily Booking (MMscfd)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const maximumHourBookingMMsArray = [
      'Maximum Hour Booking (MMscfh)',
      ...Array(resultDate.length - 1).fill(''),
    ];

    // คำนวณจำนวนเซลล์ทั้งหมดในแถวที่ 6 (รวม resultDate ทั้งหมด 4 กลุ่ม)
    const totalCellsInRow6 = 5 + resultDate.length * 4;

    // เพิ่ม "" ให้ครบตามจำนวนของแถวที่ 6 (เรามี startDate และ endDateDate ที่แถวที่ 7 แล้ว)
    const row7 = Array(totalCellsInRow6 - 5).fill('');
    const row8 = Array(totalCellsInRow6 - 5).fill(0);
    // ----

    const capacityDailyBookingArrayMMBExit = [
      'Capacity Daily Booking (MMBTU/d)',
      ...Array(resultDate.length - 1).fill(''),
    ];
    const maximumHourBookingMMBArrayExit = [
      'Maximum Hour Booking (MMBTU/h)',
      ...Array(resultDate.length - 1).fill(''),
    ];

    // คำนวณจำนวนเซลล์ทั้งหมดในแถวที่ 6 (รวม resultDate ทั้งหมด 2 กลุ่ม)
    const totalCellsInRow12 = 5 + resultDate.length * 2;

    // เพิ่ม "" ให้ครบตามจำนวนของแถวที่ 6 (เรามี startDate และ endDateDate ที่แถวที่ 7 แล้ว)
    const row13 = Array(totalCellsInRow12 - 5).fill('');
    const row14 = Array(totalCellsInRow12 - 5).fill(0);

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
        ...resultDate,
        ...resultDate,
        ...resultDate,
        ...resultDate,
      ],
      [
        '',
        'Min',
        'Max',
        'Min',
        'Max',
        '',
        '',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        sDate,
        eDate,
        ...row7,
      ],
      [
        'Sum Entry',
        '',
        '',
        '',
        '',
        '',
        '',
        ...row8,
      ],
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
        ...resultDate,
        ...resultDate,
      ],
      [
        '',
        'Min',
        'Max',
        'Min',
        'Max',
        '',
        '',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        sDate,
        eDate,
        ...row13,
      ],
      [
        'Sum Exit',
        '',
        '',
        '',
        '',
        '',
        '',
        ...row14,
      ],
    ];

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
      { s: { r: 4, c: 7 }, e: { r: 4, c: 7 + resultDate.length - 1 } },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMBArray
      {
        s: { r: 4, c: 7 + resultDate.length },
        e: { r: 4, c: 7 + resultDate.length * 2 - 1 },
      },

      // Entry Merge dynamic สำหรับ capacityDailyBookingMMsArray
      {
        s: { r: 4, c: 7 + resultDate.length * 2 },
        e: { r: 4, c: 7 + resultDate.length * 3 - 1 },
      },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMsArray
      {
        s: { r: 4, c: 7 + resultDate.length * 3 },
        e: { r: 4, c: 7 + resultDate.length * 4 - 1 },
      },

      //------

      // Merge คอลัมน์สำหรับ "Pressure Range" และ "Temperature Range"
      { s: { r: 11, c: 1 }, e: { r: 11, c: 2 } }, // Merge 'Pressure Range' header (c:6 to c:7)
      { s: { r: 11, c: 3 }, e: { r: 11, c: 4 } }, // Merge 'Temperature Range' header (c:8 to c:9)

      // Merge แถวสำหรับ "Zone" ที่รวมหลายแถว
      { s: { r: 10, c: 0 }, e: { r: 12, c: 0 } }, // Merge 'Exit' row header (r:4 to r:5)

      // // period
      { s: { r: 10, c: 5 }, e: { r: 10, c: 6 } },
      // // form to
      { s: { r: 11, c: 5 }, e: { r: 12, c: 5 } },
      { s: { r: 11, c: 6 }, e: { r: 12, c: 6 } },

      // Entry Merge dynamic สำหรับ capacityDailyBookingArrayMMBExit
      { s: { r: 10, c: 7 }, e: { r: 10, c: 7 + resultDate.length - 1 } },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMBArrayExit
      {
        s: { r: 10, c: 7 + resultDate.length },
        e: { r: 10, c: 7 + resultDate.length * 2 - 1 },
      },
    ];

    // Merge cells สำหรับ resultDate กับ row อันล่าง
    const resultDateCount = resultDate.length;

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
        s: { r: 11, c: startColumnIndex }, // จุดเริ่มต้นการ merge จากแถวที่ 11
        e: { r: 12, c: startColumnIndex }, // จุดสิ้นสุดการ merge ในแถวที่ 12
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
          (rowNumber === 2 && cell[0] === 'B') ||
          ((rowNumber === 6 || rowNumber === 7) && cell[0] === 'B') ||
          ((rowNumber === 12 || rowNumber === 13) && cell[0] === 'B')
        ) {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'FFFFCB' },
          };
        }
        if (rowNumber === 3 && cell[0] === 'B') {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'FBD4B4' },
          };
        }
        if ((rowNumber === 6 || rowNumber === 7) && cell[0] === 'D') {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'A5A5A5' },
          };
        }

        if (
          rowNumber === 12 &&
          columnLetter.charCodeAt(0) >= 'L'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'Z'.charCodeAt(0)
        ) {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'A5A5A5' },
          };
        }

        if (rowNumber === 12 && columnLetter >= 'AA' && columnLetter <= 'AF') {
          worksheet[cell].s.fill = {
            patternType: 'solid',
            fgColor: { rgb: 'A5A5A5' },
          };
        }

        if (
          rowNumber === 6 &&
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'Z'.charCodeAt(0)
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
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'Z'.charCodeAt(0)
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
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'K'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        if (
          rowNumber === 13 &&
          columnLetter.charCodeAt(0) >= 'H'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'K'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        // แปลงค่า worksheet[cell].v เป็นสตริงในรูปแบบ 'DD/MM/YYYY'
        const cellDate = worksheet[cell].v ? worksheet[cell].v.toString() : '';
        if (resultDate.includes(cellDate) && columnLetter >= 'AI') {
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

    // เขียน workbook เป็นไฟล์ Excel (ในรูปแบบ buffer)
    // http://10.100.101.15:8010/master/bulletin-board?startDate=28/10/2024&endDateDate=29/12/3025&ContractCode=test&type=3
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    const times = dayjs(
      dayjs(dayjs().tz('Asia/Bangkok').format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'))
        .tz('Asia/Bangkok')
        .toDate(),
    ).format('YYYYMMDDHHmmss');

    // ส่ง buffer กลับไปเพื่อให้ controller สามารถใช้งานต่อไปได้
    return { excelBuffer, typeOfContract: `${times}_${typeOfContract}` };
  }
}
