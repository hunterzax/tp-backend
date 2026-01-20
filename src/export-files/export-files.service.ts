import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import * as _ from 'lodash';

import * as XLSX from 'xlsx-js-style';

import * as ExcelJS from 'exceljs';

import { Response } from 'express';
import { assertSafeExternalUrl } from 'src/common/utils/url.util';
import axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween';
import { CapacityPublicationService } from 'src/capacity-publication/capacity-publication.service';
import { ReleaseCapacitySubmissionService } from 'src/release-capacity-submission/release-capacity-submission.service';
import { UseItOrLoseItService } from 'src/use-it-or-lose-it/use-it-or-lose-it.service';
import { PathManagementService } from 'src/path-management/path-management.service';
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { MeteringManagementService } from 'src/metering-management/metering-management.service';
import { QualityEvaluationService } from 'src/quality-evaluation/quality-evaluation.service';
import { QualityPlanningService } from 'src/quality-planning/quality-planning.service';
import { AllocationModeService } from 'src/allocation-mode/allocation-mode.service';
import { AllocationService } from 'src/allocation/allocation.service';
import { SummaryNominationReportService } from 'src/summary-nomination-report/summary-nomination-report.service';
import { NominationDashboardService } from 'src/nomination-dashboard/nomination-dashboard.service';
import { ParkingAllocationService } from 'src/parking-allocation/parking-allocation.service';
import { BalancingService } from 'src/balancing/balancing.service';
import { QueryShipperNominationFileService } from 'src/query-shipper-nomination-file/query-shipper-nomination-file.service';
import { DailyAdjustmentService } from 'src/daily-adjustment/daily-adjustment.service';
import { groupDataByFields } from 'src/common/utils/allcation.util';
import {
  getTodayEndAdd7,
  getTodayNow,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfault,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import { EventService } from 'src/event/event.service';
import { TariffService } from 'src/tariff/tariff.service';
import { matchTypeWithMenu, renameMethod } from 'src/common/utils/export.util';
import { parseToNumber } from 'src/common/utils/number.util';
dayjs.extend(isBetween);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');

@Injectable()
export class ExportFilesService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly capacityPublicationService: CapacityPublicationService,
    private readonly releaseCapacitySubmissionService: ReleaseCapacitySubmissionService,
    private readonly useItOrLoseItService: UseItOrLoseItService,
    private readonly pathManagementService: PathManagementService,
    private readonly uploadTemplateForShipperService: UploadTemplateForShipperService,
    private readonly meteringManagementService: MeteringManagementService,
    private readonly qualityEvaluationService: QualityEvaluationService,
    private readonly qualityPlanningService: QualityPlanningService,
    private readonly allocationModeService: AllocationModeService,
    private readonly allocationService: AllocationService,
    private readonly summaryNominationReportService: SummaryNominationReportService,
    private readonly nominationDashboardService: NominationDashboardService,
    private readonly parkingAllocationService: ParkingAllocationService,
    private readonly balancingService: BalancingService,
    private readonly queryShipperNominationFileService: QueryShipperNominationFileService,
    private readonly dailyAdjustmentService: DailyAdjustmentService,
    private readonly eventService: EventService,
    private readonly tariffService: TariffService,
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

  // -------

  exportDataToExcelNew(
    data: any[],
    response: Response,
    nameFile: string,
    skipFirstRow: boolean,
    mergeColumns: string[] = [],
    rowHeight: { rowIndex: number, height: number }[] = [],
  ): void {
    // ตรวจสอบว่ามีข้อมูลหรือไม่
    if (!data || data.length === 0) {
      response
        .status(400)
        .send({ message: 'Data is empty. Cannot generate Excel file.' });
      return;
    }

    // สร้าง workbook และ worksheet ใหม่
    const wb = XLSX.utils.book_new();
    const ws = skipFirstRow
      ? XLSX.utils.aoa_to_sheet([[]])
      : XLSX.utils.aoa_to_sheet([]);

    // เพิ่ม header ในบรรทัดที่ 2 ถ้า skipFirstRow เป็น true, ถ้าไม่เป็น true จะอยู่ที่บรรทัดที่ 1
    const headers = Object.keys(data[0]);
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: skipFirstRow ? 1 : 0 });

    // เพิ่มข้อมูลที่บรรทัดที่ 3 ถ้า skipFirstRow เป็น true, ถ้าไม่เป็น true จะอยู่ที่บรรทัดที่ 2
    if (data.length > 0) {
      XLSX.utils.sheet_add_json(ws, data, {
        origin: skipFirstRow ? 2 : 1,
        skipHeader: true,
      });
    }

    // ตรวจสอบว่า worksheet มีข้อมูลหรือไม่
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 0 || range.e.c < 0) {
      throw new Error('Worksheet is empty. Cannot generate Excel file.');
    }

    // Cell merging logic for specific columns when enableCellMerging is true
    if (mergeColumns && mergeColumns.length > 0 && data.length > 1) {

      // Find column indices for merge columns
      const columnIndices: Record<string, number> = {};
      mergeColumns.forEach(col => {
        const index = headers.indexOf(col);
        if (index !== -1) {
          columnIndices[col] = index;
        }
      });

      // Initialize merge ranges array
      const mergeRanges: any[] = [];

      // Process each merge column
      Object.keys(columnIndices).forEach(columnName => {
        const colIndex = columnIndices[columnName];
        let startRow = skipFirstRow ? 2 : 1; // Start from data row
        let endRow = startRow;

        // Go through each data row
        for (let i = 0; i < data.length; i++) {
          const currentValue = data[i][columnName];
          const nextValue = i < data.length - 1 ? data[i + 1][columnName] : null;

          // If current value is same as next value, extend the range
          if (currentValue === nextValue) {
            endRow++;
          } else {
            // If we have a range to merge (more than 1 row)
            if (endRow > startRow) {
              mergeRanges.push({
                s: { r: startRow, c: colIndex },
                e: { r: endRow, c: colIndex }
              });
            }
            // Start new range
            startRow = endRow + 1;
            endRow = startRow;
          }
        }
      });

      // Apply merge ranges to worksheet
      if (mergeRanges.length > 0) {
        ws['!merges'] = mergeRanges;
      }
    }

    // เพิ่ม worksheet ลงใน workbook
    XLSX.utils.book_append_sheet(wb, ws, 'DataSheet');

    // ปรับความกว้างของคอลัมน์แบบไดนามิก
    const objectMaxLength = headers.map((header) => header.length); // เริ่มต้นจากความยาวของ headers
    data.forEach((row) => {
      Object.keys(row).forEach((key, index) => {
        const columnLength = row[key] ? row[key].toString().length : 0;
        objectMaxLength[index] = Math.max(objectMaxLength[index], columnLength);
      });
    });

    // กำหนดความกว้างของคอลัมน์ให้พอดีกับ header และข้อมูล
    ws['!cols'] = objectMaxLength.map((maxLength) => {
      return { wch: Math.min(maxLength + 5, 30) }; // จำกัดความกว้างไม่เกิน 30
    });

    // ปรับ wrap text ในทุกเซลล์และจัดการขนาดแถวอัตโนมัติ
    ws['!rows'] = [];
    for (let R = range.s.r; R <= range.e.r; ++R) {
      let maxHeight = 20; // ค่าเริ่มต้นของความสูงแถว
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        // ตรวจสอบว่ามีข้อความในเซลล์หรือไม่
        if (ws[cellAddress].v && typeof ws[cellAddress].v === 'string') {
          // เปิดการ wrapText และจัดให้ align ซ้ายและด้านบน
          ws[cellAddress].s = {
            alignment: {
              wrapText: true, // เปิดการ wrapText ที่นี่
              vertical: 'top',
              horizontal: 'left',
            },
          };
        }

        const cellText = ws[cellAddress].v ? ws[cellAddress].v.toString() : '';
        const lines = Math.ceil(cellText.length / 30); // คำนวณจำนวนบรรทัด
        maxHeight = Math.max(maxHeight, lines * 15); // เพิ่มความสูงตามจำนวนบรรทัด
      }
      ws['!rows'][R] = { hpx: maxHeight }; // ปรับความสูงของแถวตามจำนวนบรรทัด
    }

    ws['!rows'][0] = { hidden: true };

    rowHeight.map(item => {
      ws['!rows'][item.rowIndex] = { hpt: item.height }
    })

    // Object.keys(ws).forEach((cell) => {
    //   const rowNumber = parseInt(cell.replace(/[^0-9]/g, '')); // ดึงเลขแถวออกมา
    //   const columnLetter = cell.replace(/[0-9]/g, '');

    //   if (
    //     ws[cell] &&
    //     typeof ws[cell] === 'object' &&
    //     cell[0] !== '!'
    //   ) {
    //     ws[cell].z = '@'; // ใช้รูปแบบ '@' เพื่อระบุว่าเป็น Text
    //     ws[cell].t = 's';

    //     // ✅ ถ้า row 2 และเซลล์มีข้อมูล ให้ใส่สีพื้นหลังดำและข้อความสีขาว
    //     if (rowNumber === 2 && ws[cell].v) {
    //       ws[cell].s = ws[cell].s || {}; // ตรวจสอบว่าเซลล์มี object style หรือไม่
    //       ws[cell].s.fill = {
    //         patternType: 'solid', // ✅ เติมสีพื้นหลังแบบทึบ
    //         fgColor: { rgb: '000000' }, // ✅ สีพื้นหลังดำ (Black)
    //       };
    //       ws[cell].s.font = {
    //         color: { rgb: 'FFFFFF' }, // ✅ สีข้อความเป็นสีขาว (White)
    //         bold: true, // ✅ ทำให้ตัวอักษรหนา
    //       };
    //     }
    //     // ✅ ค้นหาแถวสุดท้ายที่มีข้อมูล
    //     const lastRowWithData = Math.max(
    //       ...Object.keys(ws)
    //         .map((c) => parseInt(c.replace(/[^0-9]/g, ''), 10))
    //         .filter((n) => !isNaN(n)),
    //     );
    //     // ✅ ตั้งค่าขอบเขต (Border) สำหรับทุกเซลล์ตั้งแต่แถวที่ 5 เป็นต้นไป
    //     if (rowNumber >= 2) {
    //       ws[cell].s = ws[cell].s || {};
    //       ws[cell].s.border = ws[cell].s.border || {};

    //       // ✅ ใส่เส้นแนวตั้ง (ทุกแถว)
    //       ws[cell].s.border.left = { style: 'thin' };
    //       ws[cell].s.border.right = { style: 'thin' };

    //       // ✅ ใส่เส้นแนวนอนเฉพาะแถวสุดท้ายที่มีข้อมูล
    //       if (rowNumber === lastRowWithData) {
    //         ws[cell].s.border.bottom = { style: 'thin' };
    //       }
    //     }
    //   }
    // });

    // ตรวจสอบว่า workbook มีข้อมูลหรือไม่
    if (!wb.SheetNames.length) {
      throw new Error('Workbook is empty. Cannot generate Excel file.');
    }

    // เขียนไฟล์ Excel ลงใน Buffer
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    // กำหนดการดาวน์โหลดไฟล์ Excel
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD HH:mm')}_${nameFile}.xlsx"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(excelBuffer);
  }

  // digit2 new
  dcimal2 = (number: any) => {
    // console.log('number : ', number);
    // let numbers = number ?? 0;
    // if (isNaN(numbers)) return numbers;

    // if (numbers == 0) {
    //   return '0.00'; // special case for zero
    // }

    // const fixedNumber = parseFloat(numbers).toFixed(2); // Keep 2 decimal places
    // const [intPart, decimalPart] = fixedNumber.split('.');

    // const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    // return `${withCommas}.${decimalPart}`;

    // คืนค่าตามเดิมถ้าไม่ใช่ตัวเลข ไม่ปัดเศษ
    const n = Number(number);
    if (!Number.isFinite(n)) return number;

    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);

    // ตัดทศนิยมให้เหลือ 2 ตำแหน่ง (ไม่ปัด)
    const truncated = Math.floor(abs * 100) / 100;

    // แยกส่วนจำนวนเต็ม/ทศนิยมแล้วจัดรูปแบบ
    const [i, d = ''] = truncated.toString().split('.');
    const intWithComma = i?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const dec = d.padEnd(2, '0'); // ให้ครบ 2 หลักเสมอ

    return `${sign}${intWithComma}.${dec}`;
  };

  // digit3
  dcimal3 = (number: any) => {
    // console.log('number : ', number);
    const numbers = number ?? 0;
    if (isNaN(numbers)) return numbers;

    if (numbers == 0) {
      return '0.000'; // special case for zero
    }

    const fixedNumber = parseFloat(numbers).toFixed(3); // Keep 4 decimal places
    const [intPart, decimalPart] = fixedNumber.split('.');

    const withCommas = intPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${withCommas}.${decimalPart}`;
  };

  // digit6
  dcimal6 = (number: any) => {
    // console.log('number : ', number);
    const numbers = number ?? 0;
    if (isNaN(numbers)) return numbers;

    if (numbers == 0) {
      return '0.000000'; // special case for zero
    }

    const fixedNumber = parseFloat(numbers).toFixed(6); // Keep 4 decimal places
    const [intPart, decimalPart] = fixedNumber.split('.');

    const withCommas = intPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${withCommas}.${decimalPart}`;
  };

  // digit4
  dcimal4 = (number: any) => {
    // console.log('number : ', number);
    const numbers = number ?? 0;
    if (isNaN(numbers)) return numbers;

    if (numbers == 0) {
      return '0.0000'; // special case for zero
    }

    const fixedNumber = parseFloat(numbers).toFixed(4); // Keep 4 decimal places
    const [intPart, decimalPart] = fixedNumber.split('.');

    const withCommas = intPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${withCommas}.${decimalPart}`;
  };

  // เปลี่ยนท้าย telephone เป็น xxx
  maskLastFiveDigits(value: string): string {
    if (value.length <= 5) {
      return 'X'.repeat(value.length);
    }
    const visiblePart = value.slice(0, -5);
    const maskedPart = 'X'.repeat(5);
    return visiblePart + maskedPart;
  }

  // เปลี่ยนท้าย email เป็น xxx
  anonymizeEmail(email: string) {
    return email?.replace(/([^@]{3})@/, 'xxx@');
  }

  // เติมทศนิยม 3 ตำแหน่ง new
  formatNumberThreeDecimal(number: any) {
    // if (isNaN(number)) return number; // Handle invalid numbers gracefully

    // // Convert number to a fixed 3-decimal format
    // const fixedNumber = Number(number).toFixed(3);

    // // Add thousand separators
    // return fixedNumber.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    // คืนค่าตามเดิมถ้าไม่ใช่ตัวเลข ไม่ปัดเศษ
    const n = Number(number);
    if (!Number.isFinite(n)) return number;

    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);

    // ตัดทศนิยมให้เหลือ 3 ตำแหน่ง (ไม่ปัด)
    const truncated = Math.floor(abs * 1000) / 1000;

    // แยกส่วนจำนวนเต็ม/ทศนิยมแล้วจัดรูปแบบ
    const [i, d = ''] = truncated.toString().split('.');
    const intWithComma = i?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const dec = d.padEnd(3, '0'); // ให้ครบ 3 หลักเสมอ

    return `${sign}${intWithComma}.${dec}`;
  }

  // เติมทศนิยม 4 ตำแหน่ง new
  formatNumberFDecimal(number: any) {
    // if (isNaN(number)) return number; // Handle invalid numbers gracefully

    // // Convert number to a fixed 3-decimal format
    // const fixedNumber = Number(number).toFixed(3);

    // // Add thousand separators
    // return fixedNumber.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    // คืนค่าตามเดิมถ้าไม่ใช่ตัวเลข ไม่ปัดเศษ
    const n = Number(number);
    if (!Number.isFinite(n)) return number;

    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);

    // ตัดทศนิยมให้เหลือ 3 ตำแหน่ง (ไม่ปัด)
    const truncated = Math.floor(abs * 10000) / 10000;

    // แยกส่วนจำนวนเต็ม/ทศนิยมแล้วจัดรูปแบบ
    const [i, d = ''] = truncated.toString().split('.');
    const intWithComma = i?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const dec = d.padEnd(4, '0'); // ให้ครบ 3 หลักเสมอ

    return `${sign}${intWithComma}.${dec}`;
  }

  // เติมทศนิยม 4 ตำแหน่ง
  // formatNumberFDecimal(number: any) {
  //   if (isNaN(number)) return number; // Handle invalid numbers gracefully

  //   // Convert number to a fixed 4-decimal format
  //   const fixedNumber = parseFloat(number).toFixed(4);

  //   // Add thousand separators
  //   return fixedNumber.replace(/\B(?=(\d{4})+(?!\d))/g, ',');
  // }
  // formatNumberFDecimal = (number: any) => {
  //   if (isNaN(number)) return number;

  //   if (number == 0) {
  //     return '0.0000'; // special case for zero
  //   }

  //   const fixedNumber = parseFloat(number).toFixed(4); // Keep 4 decimal places
  //   const [intPart, decimalPart] = fixedNumber.split('.');

  //   const withCommas = intPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  //   return `${withCommas}.${decimalPart}`;
  // };

  // formate เวลา 00:00
  formatNumberHour(hour: any, minute: any) {
    return `${hour !== undefined && String(hour).padStart(2, '0')}:${minute !== undefined && String(minute).padStart(2, '0')}`;
  }

  // ตัด url. เหลือแค่ name
  cutUploadFileName(url: any) {
    // const url = "http://10.100.101.126:9010/exynos/20241003093613_readme.pdf";
    const cutString = url.substring(url.indexOf('_') + 1);
    // console.log(cutString); // Output: "readme.pdf"
    return cutString;
  }

  createNodeEdges(revised_capacity_path, revised_capacity_path_edges) {
    // ดึง node เริ่มต้นที่ area.entry_exit_id === 1
    const startNode = revised_capacity_path.find(
      (area) => area.area.entry_exit_id === 1,
    );

    if (!startNode) {
      throw new Error('ไม่พบ node เริ่มต้นที่มี entry_exit_id === 1');
    }

    const resultNodeEdges = {
      nodes: [],
      edges: [],
    };

    // สร้าง map สำหรับ edges เพื่อเชื่อมโยง source_id -> target_id
    const edgesMap = new Map();
    revised_capacity_path_edges.forEach((edge) => {
      edgesMap.set(edge.source_id, edge.target_id);
    });

    // ไล่โหนดตาม chain
    let currentNodeId = startNode.area.id;
    while (currentNodeId) {
      // ดึงข้อมูล node ปัจจุบัน
      const currentNode = revised_capacity_path.find(
        (area) => area.area.id === currentNodeId,
      );

      if (currentNode) {
        // เพิ่ม node เข้า result
        resultNodeEdges.nodes.push({
          id: currentNode.area.id,
          name: currentNode.area.name,
          ...currentNode.area, // เพิ่มข้อมูลอื่นๆ ของ area
        });

        // ดึง target_id สำหรับโหนดต่อไป
        const nextNodeId = edgesMap.get(currentNodeId);

        // เพิ่ม edge เข้า result
        if (nextNodeId) {
          resultNodeEdges.edges.push({
            source: currentNodeId,
            target: nextNodeId,
          });
        }

        // เดินหน้าไปยังโหนดถัดไป
        currentNodeId = nextNodeId;
      } else {
        // หากไม่พบ node ปัจจุบันใน revised_capacity_path หยุด
        break;
      }
    }

    return resultNodeEdges;
  }

  // Dam
  async epDamTsoGroup(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.group.findMany({
      include: {
        user_type: true,
        bank_master: true,
        role_default: {
          include: {
            role: true,
          },
        },
        division: true,
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
      where: {
        user_type_id: Number(2),
        // active: true,
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );

    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: String(!!e['status']),
        ['TSO ID']: e['id_name'] || null,
        ['Group Name']: e['name'] || null,
        ['Division Name']:
          (e['division'].length > 0 &&
            e['division']
              .map((division: any) => `${division?.division_name}`)
              .join(',')) ||
          null,
        ['Default Role']: e['role_default'][0]?.['role']?.name || null,
        ['Telephone']:
          (!!e['telephone'] && this.maskLastFiveDigits(e['telephone'])) || null,
        ['Email']: (!!e['email'] && this.anonymizeEmail(e['email'])) || null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'TSO Group', true);
  }

  async epDamShippersGroup(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.group.findMany({
      include: {
        user_type: true,
        bank_master: true,
        role_default: {
          include: {
            role: true,
          },
        },
        division: true,
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
        shipper_contract_point: {
          include: {
            contract_point: true,
          },
        },
      },
      where: {
        user_type_id: Number(3),
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: e['status'] ? 'Active' : 'Inactive',
        ['Shipper ID']: e['id_name'] || null,
        ['Shipper Name']: e['name'] || null,
        ['Shipper Company Name']: e['company_name'] || null,
        ['Division Name']:
          (e['division'].length > 0 &&
            e['division']
              .map((division: any) => `${division?.division_name}`)
              .join(',')) ||
          null,
        ['Default Role']: e['role_default'][0]?.['role']?.name || null,
        ['Address']: e['address'] || null,
        ['Telephone']:
          (!!e['telephone'] && this.maskLastFiveDigits(e['telephone'])) || null,
        ['Email']: (!!e['email'] && this.anonymizeEmail(e['email'])) || null,
        ['Bank Account']:
          (!!e['bank_no'] && this.maskLastFiveDigits(e['bank_no'])) || null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
        ['Group ID']:
          (e['shipper_contract_point'].length > 0 &&
            e['shipper_contract_point']
              .map(
                (shipper_contract_point: any) =>
                  `${shipper_contract_point?.contract_point?.contract_point}`,
              )
              .join(',')) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Shippers Group',
      true,
    );
  }

  async epDamOtherGroup(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.group.findMany({
      include: {
        user_type: true,
        bank_master: true,
        role_default: {
          include: {
            role: true,
          },
        },
        division: true,
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
      where: {
        user_type_id: Number(4),
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: e['status'] ? 'Active' : 'Inactive',
        ['Other ID']: e['id_name'] || null,
        ['Group Name']: e['name'] || null,
        ['Division Name']:
          (e['division'].length > 0 &&
            e['division']
              .map((division: any) => `${division?.division_name}`)
              .join(',')) ||
          null,
        ['Default Role']: e['role_default'][0]?.['role']?.name || null,
        ['Telephone']:
          (!!e['telephone'] && this.maskLastFiveDigits(e['telephone'])) || null,
        ['Email']: (!!e['email'] && this.anonymizeEmail(e['email'])) || null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'Other Group', true);
  }

  async epDamUsers(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.account.findMany({
      where: {
        id: {
          not: 1,
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        account_manage: {
          include: {
            user_type: {
              include: {
                column_table_config: {
                  include: {
                    column_table: true,
                    column_field: true,
                  },
                },
              },
            },
            mode_account: true,
            division: true,
            group: {
              include: {
                division: true,
              },
            },
            account_role: {
              include: {
                role: {
                  where: {
                    active: true,
                  },
                  include: {
                    menus_config: {
                      include: {
                        menus: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        account_reason: true,
        type_account: true,
        created_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        updated_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        login_logs: {
          select: {
            id: true,
            create_date: true,
          },
          orderBy: {
            id: 'desc', // เรียง login_logs ตาม id ในลำดับที่ลดลง
          },
          take: 1,
        },
      },
      orderBy: {
        id: 'asc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    console.log('sortedResData : ', sortedResData);

    function getLastLoginDuration(row: any) {
      let text = ''
      if (row?.login_logs?.length > 0) {
        const lastLogin = dayjs(row?.login_logs[0]?.create_date)
        const now = dayjs()
        let duration = now.diff(lastLogin, 'month')
        if (duration > 0) {
          if (duration >= 12) {
            duration = now.diff(lastLogin, 'year')
            text = `${duration} ${duration == 1 ? 'year' : 'years'}`
          }
          else {
            text = `${duration} ${duration == 1 ? 'month' : 'months'}`
          }
        }
        else {
          duration = now.diff(lastLogin, 'day')
          text = `${duration} ${duration == 1 ? 'day' : 'days'}`
        }
      }
      return text
    }

    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Login Mode']: e['account_manage'][0]?.['mode_account']?.['name'],
        ['Status']: String(!!e['status']),
        ['User ID']: e['user_id'] || null,
        ['Company/Group Name']:
          e['account_manage'][0]?.['group']?.['name'] || null,
        ['User Type']: e['account_manage'][0]?.['user_type']?.['name'] || null,
        ['Division Name']:
          e['account_manage'][0]?.['division']?.['division_name'] || null,
        ['First Name']: e['first_name'] || null,
        ['Last Name']: e['last_name'] || null,
        ['Type']: e['type_account']?.['name'] || null,
        ['Role']:
          e['account_manage'][0]?.['account_role'][0]?.['role']?.['name'] ||
          null,
        ['Telephone']:
          (!!e['telephone'] && this.maskLastFiveDigits(e['telephone'])) || null,
        ['Email']: (!!e['email'] && this.anonymizeEmail(e['email'])) || null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
        ['Reason']:
          (e['account_reason'].length > 0 &&
            e['account_reason']
              .map(
                (reason: any) =>
                  `${reason?.reason} (${reason?.create_date ? dayjs(reason?.create_date).format('DD/MM/YYYY HH:mm') : '-'}`,
              )
              .join(',')) ||
          null,
        ['Created by']: `${(!!e['created_by_account']?.['first_name'] &&
          e['created_by_account']?.['first_name']) ||
          ''
          } ${(!!e['created_by_account']?.['last_name'] &&
            e['created_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['updated_by_account']?.['first_name'] &&
          e['updated_by_account']?.['first_name']) ||
          ''
          } ${(!!e['updated_by_account']?.['last_name'] &&
            e['updated_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        //
        ['Lasted Login']:
          (e['login_logs'].length > 0 &&
            dayjs(e['login_logs'][0]?.create_date).tz('Asia/Bangkok').format(
              'DD/MM/YYYY HH:mm',
            )) ||
          null,
        ['Last Login Duration']: getLastLoginDuration(e)
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'Users', true);
  }

  async epDamRoles(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.role.findMany({
      include: {
        user_type: true,
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
      where: {
        // active: true,
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      orderBy: {
        id: 'asc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['User Type']: e['user_type']?.['name'] || null,
        ['Role Name']: e['name'] || null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'Roles', true);
  }

  async epDamLoginManagementTool(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.system_login.findMany({
      include: {
        role: true,
        mode_account: true,
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
        system_login_account: {
          include: {
            account: {
              select: {
                id: true,
                email: true,
                status: true,
                password_gen_flag: true,
                password_gen_origin: true,
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
        },
      },
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Login Mode']: e['mode_account']?.['name'],
        ['Role Name']: e['role']?.['name'] || null,
        ['Users']:
          (e['system_login_account'].length > 0 &&
            e['system_login_account']
              .map(
                (system_login_account: any) =>
                  `${system_login_account?.account?.email} (${system_login_account?.account?.password_gen_flag ? 'generate' : 'waiting generate'}`,
              )
              .join(',')) ||
          null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Login Management Tool',
      true,
    );
  }

  async epDamDivision(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.division.findMany({
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
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Division ID']: e['division_id'],
        ['Division Name']: e['division_name'],
        ['Division Short Name']: e['division_short_name'],
        ['Create Date']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'Division', true);
  }



  async epDamAuditLog(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.history.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      select: {
        id: true,
        reqUser: true,
        type: true,
        module: true,
        create_date: true,
        create_date_num: true,
        method: true,
        // value:true,
      },
      orderBy: {
        id: 'desc',
      },
    });
    console.log('resData : ', resData);
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    // https://app.clickup.com/t/86eujxj45
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['ID']: e['id'],
        ['Module']: e['module'],
        ['Action Date']:
          (!!e['create_date'] &&
            dayjs(e['create_date']).format('DD/MM/YYYY HH:mm')) ||
          null,
        ['First Name / Last Name']: (() => {
          const reqUser = this.safeParseJSON(e?.reqUser);
          return (reqUser?.first_name || '') + ' ' + (reqUser?.last_name || '');
        })(),
        // ['Description']: e['method'],
        ['Description']: `${renameMethod(e?.method, e?.type)} ${matchTypeWithMenu(e?.type)}`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'Audit Log', true);
  }

  async epDamZone(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.zone.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        entry_exit: true,
        zone_master_quality: true,
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
      orderBy: { id: 'asc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Entry / Exit']: e['entry_exit']?.['name'],
        ['Zone Name']: e['name'],
        ['Description']: e['description'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'Zone', true);
  }

  async epDamArea(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.area.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        supply_reference_quality_area_by: true,
        zone: true,
        entry_exit: true,
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
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Entry / Exit']: e['entry_exit']?.['name'],
        ['Zone']: e['zone']?.['name'],
        ['Area Name']: e['name'],
        ['Description']: e['description'],
        // ['Area Nominal Capacity (MMBTH / D)']:
        ['Area Nominal Capacity (MMBTH/D)']:
          (!!e['area_nominal_capacity'] &&
            this.formatNumberThreeDecimal(e['area_nominal_capacity'])) ||
          null,
        ['Supply Reference Quality Area']:
          e['supply_reference_quality_area_by']?.['name'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'Area', true);
  }

  async epDamCustomer(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.customer_type.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        entry_exit: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Entry / Exit']: e['entry_exit']?.['name'],
        ['Customer Type']: e['name'],
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Customer Type',
      true,
    );
  }

  async epDamContractPoint(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.contract_point.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        area: true,
        zone: true,
        entry_exit: true,
        contract_nomination_point: {
          include: {
            nomination_point: {
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Entry/Exit']: e['entry_exit']?.['name'],
        ['Zone']: e['zone']?.['name'],
        ['Area']: e['area']?.['name'],
        ['Contract Point']: e['contract_point'],
        ['Description']: e['description'],
        ['Start Date']: e['contract_point_start_date']
          ? dayjs(e['contract_point_start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['contract_point_end_date']
          ? dayjs(e['contract_point_end_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Contract Point',
      true,
    );
  }

  async epDamNominationPoint(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.nomination_point.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        contract_point: true,
        contract_point_list: true,
        zone: true,
        area: true,
        entry_exit: true,
        customer_type: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Entry / Exit']: e['entry_exit']?.['name'],
        ['Zone']: e['zone']?.['name'],
        ['Area']: e['area']?.['name'],
        // ['Contract Point']: e['contract_point']?.['contract_point'],
        ['Contract Point']:
          (e['contract_point_list'].length > 0 &&
            e['contract_point_list']
              .map(
                (contract_point_list: any) =>
                  `${contract_point_list?.contract_point}`,
              )
              .join(',')) ||
          null,
        ['Nomination Point']: e['nomination_point'],
        ['Description']: e['description'],
        ['Customer Type']: e['customer_type']?.['name'],
        ['Maximum Capacity (MMSCFD)']:
          (!!e['maximum_capacity'] &&
            this.formatNumberThreeDecimal(e['maximum_capacity'])) ||
          null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Nomination Point',
      true,
    );
  }

  async epDamMeteredPoint(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.metering_point.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        point_type: true,
        entry_exit: true,
        customer_type: true,
        zone: true,
        area: true,
        non_tpa_point: true,
        nomination_point: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Metered ID']: e['metered_id'],
        ['Metered Point Name']: e['metered_point_name'],
        ['Description']: e['description'],
        ['Entry / Exit']: e['entry_exit']?.['name'],
        ['Zone']: e['zone']?.['name'],
        ['Area']: e['area']?.['name'],
        ['Customer Type']: e['customer_type']?.['name'],
        ['Nomination Point / Non TPA Point']:
          e['nomination_point']?.['nomination_point'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Metered Point',
      true,
    );
  }

  async epDamConceptPoint(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.concept_point.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        type_concept_point: true,
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
        id: 'asc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Concept Points']: e['concept_point'],
        ['Type Concept Points']: e['type_concept_point']?.['name'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Concept Point',
      true,
    );
  }

  async epDamNonTpaPoint(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.non_tpa_point.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        area: true,
        nomination_point: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Area']: e['area']?.['name'],
        ['Non TPA Point Name']: e['non_tpa_point_name'],
        ['Description']: e['description'],
        ['Nomination Point']: e['nomination_point']?.['nomination_point'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Non TPA Point',
      true,
    );
  }

  async epDamConfigMasterPath(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.config_master_path.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        revised_capacity_path: {
          include: {
            area: true,
          },
        },
        revised_capacity_path_edges: true,
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
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: e['active'],
        ['Path No.']: e['path_no'],
        ['Revised Capacity Path']:
          (e['revised_capacity_path'].length > 0 &&
            e['revised_capacity_path']
              .map(
                (revised_capacity_path: any) =>
                  `${revised_capacity_path?.area?.name}`,
              )
              .join(' -> ')) ||
          null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Config Master Path',
      true,
    );
  }

  async epDamModeBaseZoneInventory(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.mode_zone_base_inventory.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        zone: true,
        mode: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Zone']: e['zone']?.['name'],
        ['Mode']: e['mode']?.['mode'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY HH:mm')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm:ss') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm:ss') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Mode/Zone Base Inventory',
      true,
    );
  }

  async epDamCapacityRightTemplate(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.booking_template.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        term_type: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Term']: e['term_type']?.['name'],
        ['File Period']:
          e['file_period_mode'] === 1
            ? 'Days'
            : e['file_period_mode'] === 2
              ? 'Months'
              : e['file_period_mode'] === 3
                ? 'Years'
                : '',
        ['Period Min']: e['min'],
        ['Period Max']: e['max'],
        ['File Recurring Start Date']:
          e['file_start_date_mode'] === 1
            ? 'Every Day'
            : e['file_start_date_mode'] === 2
              ? 'Fix Day'
              : e['file_start_date_mode'] === 3
                ? 'To Day+'
                : '',
        ['Shadow Time']: e['shadow_time'],
        ['Unit']:
          e['file_start_date_mode'] === 1
            ? 'Days'
            : e['file_start_date_mode'] === 2
              ? 'Months'
              : e['file_start_date_mode'] === 3
                ? 'Days'
                : '',
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Capacity Right Template',
      true,
    );
  }

  async epDamPlanningDeadline(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.planning_deadline.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        term_type: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Term']: e['term_type']?.['name'],
        ['End Time']: this.formatNumberHour(e['hour'] || 0, e['minute'] || 0),
        ['Date of Month']: e['day'],
        ['Before Month']: e['before_month'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Planning Deadline',
      true,
    );
  }

  async epDamNominationDeadline(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.new_nomination_deadline.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        user_type: true,
        nomination_type: true,
        process_type: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['User Type']: e['user_type']?.['name'],
        ['Process Type']: e['process_type']?.['name'],
        ['Nomination Type']: e['nomination_type']?.['document_type'],
        ['Time']: this.formatNumberHour(e['hour'] || 0, e['minute'] || 0),
        ['Before Gas Day']: e['before_gas_day'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Nomination Deadline',
      true,
    );
  }

  async epDamEmailNotificationManagement(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.email_notification_management.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        menus: true,
        activity: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Module']: e['menus']?.['name'],
        ['Activity']: e['activity']?.['name'],
        ['Subject']: e['subject'],
        ['Active']: e['active'],
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Email Notification Management',
      true,
    );
  }

  async epDamEmailGroupForEvent(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.edit_email_group_for_event.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        edit_email_group_for_event_match: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Email Group Name']: e['name'],
        ['Person']:
          (e['edit_email_group_for_event_match'].length > 0 &&
            e['edit_email_group_for_event_match']
              .map(
                (edit_email_group_for_event_match: any) =>
                  `${edit_email_group_for_event_match?.email}`,
              )
              .join(',')) ||
          null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Email Group For Event',
      true,
    );
  }

  async epDamSystemParameter(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.system_parameter.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        menus: true,
        system_parameter: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Module']: e['menus']?.['name'],
        ['System Parameter']: e['system_parameter']?.['name'],
        ['Value']:
          (e['value'] && this.formatNumberThreeDecimal(e['value'])) || null,
        ['Link']: e['link'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'System Parameter',
      true,
    );
  }

  // ยังไม่มี
  // async epDamhvForOperationFlowAndInstructedFlow(response: Response, payload: any) {
  //   const { id, filter } = payload || {};
  //   const idArray = id;
  //   const resData = await this.prisma.system_parameter.findMany({
  //     where: {
  //       id: {
  //         in: [...(idArray || []).map((idN: any) => Number(idN))],
  //       },
  //     },
  //     include: {
  //       menus: true,
  //       system_parameter: true,
  //       create_by_account: {
  //         select: {
  //           id: true,
  //           email: true,
  //           first_name: true,
  //           last_name: true,
  //         },
  //       },
  //       update_by_account: {
  //         select: {
  //           id: true,
  //           email: true,
  //           first_name: true,
  //           last_name: true,
  //         },
  //       },
  //     },
  //     orderBy: {
  //       id: 'desc',
  //     },
  //   });
  //   const sortedResData = resData.sort(
  //     (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
  //   );
  //   const formateData = await sortedResData.map((e: any) => {
  //     let setData = {
  //       ['Module']: e['menus']?.['name'],
  //       ['System Parameter']: e['system_parameter']?.['name'],
  //       ['Value']: e['value'] && this.formatNumberThreeDecimal(e['value']) || null,
  //       ['Link']: e['link'],
  //       ['Start Date']: !!e['start_date']
  //         ? dayjs(e['start_date']).format('DD/MM/YYYY')
  //         : null,
  //       ['End Date']: !!e['end_date']
  //         ? dayjs(e['end_date']).format('DD/MM/YYYY')
  //         : null,
  //     };
  //     let filteredData = Object.keys(setData)
  //       .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
  //       .reduce((obj, key) => {
  //         obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
  //         return obj;
  //       }, {});
  //     // filter
  //     return filteredData;
  //   });
  //   await this.exportDataToExcelNew(
  //     formateData,
  //     response,
  //     'System Parameter',
  //     true,
  //   );
  // }

  async epDamConfigModeZoneBaseInventory(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.config_mode_zone_base_inventory.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        zone: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Zone']: e['zone']?.['name'],
        ['Mode']: e['mode'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Config Mode/Zone Base Inventory',
      true,
    );
  }

  async epDamUserGuide(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.user_guide.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        user_guide_match: {
          include: {
            role: {
              include: {
                user_type: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Document Name']: e['document_name'],
        ['File']: (!!e['file'] && this.cutUploadFileName(e['file'])) || null,
        ['Description']: e['description'],
        // ['Download']: e['file'],
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'User Guide', true);
  }

  async epDamMeteringCheckingCondition(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.check_condition.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Version']: e['version'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Metering Checking Condition',
      true,
    );
  }

  async epDamCapacityPublicationRemarks(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.capacity_publication_remark.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
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
        id: 'asc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
        ['Remark']: e['remark'],
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Capacity Publication Remarks',
      true,
    );
  }

  async epDamAnnouncement(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.announcement.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: e['status'] ? 'Active' : 'Inactive',
        ['Topic']: e['topic'],
        ['Detail']: e['detail'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Announcement',
      true,
    );
  }

  async epDamTermsAndConditions(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.t_and_c.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Topic']: e['topic'],
        ['File']: (!!e['url'] && this.cutUploadFileName(e['url'])) || null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Terms & Conditions',
      true,
    );
  }

  async epDamAllocationMode(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.allocation_mode.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        allocation_mode_type: true,
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
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Mode']: e['allocation_mode_type']?.['mode'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Allocation Mode',
      true,
    );
  }

  async epDamhvForPerationFlowAndInstructedFlow(
    response: Response,
    payload: any,
  ) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData =
      await this.prisma.hv_for_peration_flow_and_instructed_flow.findMany({
        where: {
          id: {
            in: [...(idArray || []).map((idN: any) => Number(idN))],
          },
        },
        include: {
          group: true,
          hv_type: true,
          metering_point: true,
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
        orderBy: { id: 'desc' },
      });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Type']: e['hv_type']?.['type'],
        ['Shipper Name']: e['group']?.['name'],
        ['Meter Point']: e['metering_point']?.['metered_point_name'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Allocation Mode',
      true,
    );
  }

  // ********************
  // Capacity
  async epCapacityPublicationYear(response: Response, payload: any) {
    const { filter, startYear, endYear } = payload || {};
    const resData = await this.capacityPublicationService.getYearly(
      startYear,
      endYear,
    );
    const formateData = await resData.map((e: any) => {
      const formattedData2 = e['year_data'].reduce((acc, item) => {
        const [year, data] = Object.entries(item)[0]; // ดึง key (ปี) และ value (ข้อมูล)
        acc[`${year} `] =
          (!!data['area_nominal_capacity'] &&
            this.formatNumberThreeDecimal(data['area_nominal_capacity'])) ||
          "0.000"; // ใช้ key เป็นปี และ value เป็น area_nominal_capacity
        return acc;
      }, {});

      // const area_nominal_capacity = filter.find((f: any) => {
      //   return f === 'Available Capacity (MMBTU/D)';
      // });
      // if (!!area_nominal_capacity) {
      //   let newKeys = Object.keys(formattedData2);
      //   filter = [...filter, ...newKeys];
      // }

      const setData = {
        ['Zone']: e['zone']?.['name'],
        ['Area']: e['name'],
        ['Available Capacity (MMBTU/D)']: {
          ...formattedData2,
        },
      };

      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});

      return filteredData;
    });

    // await this.exportDataToExcelNew(
    //   formateData,
    //   response,
    //   'Capacity Publication Yearly',
    //   true,
    // );
    await this.exportDataToExcelWithMultiLevelHeader(
      formateData,
      response,
      'Capacity Publication Yearly',
      true,
    );
  }

  async epCapacityPublicationMonth(response: Response, payload: any) {
    const { filter, startMonth, endMonth } = payload || {};
    // let { startMonth, endMonth } = payload;
    // let filter = [
    //   // "Zone",
    //   "Area",
    //   "Available Capacity (MMBTU/D)",
    //   "Apr 2025 "
    // ]
    const areaAll = await this.prisma.area.findMany({
      include: {
        entry_exit: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        capacity_publication: {
          select: {
            id: true,
            zone_id: true,
            area_id: true,
            capacity_publication_date: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    const resData = await this.capacityPublicationService.generateDataMonthly(
      areaAll,
      startMonth,
      endMonth,
    );
    console.log('filter : ', filter);
    // console.log('resData : ', resData);
    const formateData = await resData.map((e: any) => {
      const formattedData2 = e['month_data'].reduce((acc, item) => {
        const [month, data] = Object.entries(item)[0]; // ดึง key (ปี) และ value (ข้อมูล)
        console.log('month : ', month);
        acc[`${dayjs(month, 'YYYY-MM').format('MMM YYYY')} `] =
          (!!data['area_nominal_capacity'] &&
            this.formatNumberThreeDecimal(data['area_nominal_capacity'])) ||
          "0.000"; // ใช้ key เป็นปี และ value เป็น area_nominal_capacity
        return acc;
      }, {});

      // const area_nominal_capacity = filter.find((f: any) => {
      //   return f === 'Available Capacity (MMBTU/D)';
      // });
      // if (!!area_nominal_capacity) {
      //   let newKeys = Object.keys(formattedData2);
      //   console.log('newKeys : ', newKeys);
      //   filter = [...filter, ...newKeys];
      // }
      console.log('formattedData2 : ', formattedData2);
      console.log('filter : ', filter);
      const setData = {
        ['Zone']: e['zone']?.['name'],
        ['Area']: e['name'],
        ['Available Capacity (MMBTU/D)']: {
          ...formattedData2,
        },
      };

      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});

      console.log('filter : ', filter);
      console.log('setData : ', setData);
      console.log('filteredData : ', filteredData);
      return filteredData;
    });
    console.log('formateData : ', formateData);
    // await this.exportDataToExcelNew(
    //   formateData,
    //   response,
    //   'Capacity Publication Monthly',
    //   true,
    // );

    await this.exportDataToExcelWithMultiLevelHeader(
      formateData,
      response,
      'Capacity Publication Monthly',
      true,
    );
  }

  async epCapacityPublicationDay(response: Response, payload: any) {
    const { filter, date } = payload || {};
    const areaAll = await this.prisma.area.findMany({
      include: {
        entry_exit: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        capacity_publication: {
          select: {
            id: true,
            zone_id: true,
            area_id: true,
            capacity_publication_date: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    const resData = await this.capacityPublicationService.generateDataDay(
      areaAll,
      date,
    );

    const formateData = await resData.map((e: any) => {
      const formattedData2 = e['day_data'].reduce((acc, item) => {
        const [days, data] = Object.entries(item)[0]; // ดึง key (ปี) และ value (ข้อมูล)
        acc[`${dayjs(days, 'YYYY-MM-DD').format('DD/MM/YYYY')} `] =
          (!!data['area_nominal_capacity'] &&
            this.formatNumberThreeDecimal(data['area_nominal_capacity'])) ||
          "0.000"; // ใช้ key เป็นปี และ value เป็น area_nominal_capacity
        return acc;
      }, {});

      // const area_nominal_capacity = filter.find((f: any) => {
      //   return f === 'Available Capacity (MMBTU/D)';
      // });
      // if (!!area_nominal_capacity) {
      //   let newKeys = Object.keys(formattedData2);
      //   filter = [...filter, ...newKeys];
      // }

      const setData = {
        ['Zone']: e['zone']?.['name'],
        ['Area']: e['name'],
        ['Available Capacity (MMBTU/D)']: {
          ...formattedData2,
        },
      };

      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});

      return filteredData;
    });

    // await this.exportDataToExcelNew(
    //   formateData,
    //   response,
    //   'Capacity Publication Daily',
    //   true,
    // );
    await this.exportDataToExcelWithMultiLevelHeader(
      formateData,
      response,
      'Capacity Publication Daily',
      true,
    );
  }

  async epCapacityPublicationDetail(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.capacity_publication_detail.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        area: {
          include: {
            zone: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Zone']: e['area']?.['zone']?.['name'],
        ['Area']: e['area']?.['name'],
        ['Available Capacity (MMBTU/D)']:
          (!!e['avaliable_capacity_mmbtu_d'] &&
            this.formatNumberThreeDecimal(e['avaliable_capacity_mmbtu_d'])) ||
          null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    // await this.exportDataToExcelNew(
    //   formateData,
    //   response,
    //   'Capacity Publication Detail',
    //   true,
    // );
    await this.exportDataToExcelWithMultiLevelHeader(
      formateData,
      response,
      'Capacity Publication Detail',
      true,
    );
  }

  async epCapacityCapacityContractManagement(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.contract_code.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
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
          },
          orderBy: {
            id: 'desc',
          },
        },
      },
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: e['status_capacity_request_management_process']?.['name'],
        ['Contract Type']: e['term_type']?.['name'],
        ['Contract Code']: e['contract_code'],
        ['Submitted Timestamp']: e['submitted_timestamp']
          ? dayjs(e['submitted_timestamp']).format('DD/MM/YYYY')
          : null,
        ['Contract Start Date']: e['contract_start_date']
          ? dayjs(e['contract_start_date']).format('DD/MM/YYYY')
          : null,
        ['Contract End Date']: e['contract_end_date']
          ? dayjs(e['contract_end_date']).format('DD/MM/YYYY')
          : null,
        ['Terminate Date']: e['terminate_date']
          ? dayjs(e['terminate_date']).format('DD/MM/YYYY')
          : null,
        ['Extend Deadline']: e['extend_deadline']
          ? dayjs(e['extend_deadline']).format('DD/MM/YYYY')
          : null,
        ['Shipper ID']: e['group']?.['id_name'],
        ['Shipper Name']: e['group']?.['name'],
        ['Type']: e['type_account']?.['name'],
        ['Contract Status']: e['status_capacity_request_management']?.['name'],
        ['Submission Comment']:
          (e['submission_comment_capacity_request_management'].length > 0 &&
            e['submission_comment_capacity_request_management']
              .map(
                (submission_comment_capacity_request_management: any) =>
                  `${submission_comment_capacity_request_management?.remark}`,
              )
              .join(',')) ||
          null,
        ['File']:
          (e['file_capacity_request_management'].length > 0 &&
            e['file_capacity_request_management']
              .map(
                (file_capacity_request_management: any) =>
                  `${file_capacity_request_management?.url}`,
              )
              .join(',')) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Capacity Contract Management',
      true,
    );
  }

  async epCapacityCapacityContractList(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.contract_code.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
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
          },
          orderBy: {
            id: 'desc',
          },
        },
      },
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: e['status_capacity_request_management_process']?.['name'],
        ['Contract Type']: e['term_type']?.['name'],
        ['Contract Code']: e['contract_code'],
        ['Submitted Timestamp']: e['submitted_timestamp']
          ? dayjs(e['submitted_timestamp']).format('DD/MM/YYYY')
          : null,
        ['Contract Start Date']: e['contract_start_date']
          ? dayjs(e['contract_start_date']).format('DD/MM/YYYY')
          : null,
        ['Contract End Date']: e['contract_end_date']
          ? dayjs(e['contract_end_date']).format('DD/MM/YYYY')
          : null,
        ['Terminate Date']: e['terminate_date']
          ? dayjs(e['terminate_date']).format('DD/MM/YYYY')
          : null,
        ['Extend Deadline']: e['extend_deadline']
          ? dayjs(e['extend_deadline']).format('DD/MM/YYYY')
          : null,
        ['Shipper ID']: e['group']?.['id_name'],
        ['Shipper Name']: e['group']?.['name'],
        ['Type']: e['type_account']?.['name'],
        ['Contract Status']: e['status_capacity_request_management']?.['name'],
        ['Submission Comment']:
          (e['submission_comment_capacity_request_management'].length > 0 &&
            e['submission_comment_capacity_request_management']
              .map(
                (submission_comment_capacity_request_management: any) =>
                  `${submission_comment_capacity_request_management?.remark}`,
              )
              .join(',')) ||
          null,
        ['File']:
          (e['file_capacity_request_management'].length > 0 &&
            e['file_capacity_request_management']
              .map(
                (file_capacity_request_management: any) =>
                  `${file_capacity_request_management?.url}`,
              )
              .join(',')) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Capacity Contract List',
      true,
    );
  }

  async epCapacityReleaseCapacitySubmission(response: Response, payload: any) {
    const { id, filter, contractCode } = payload || {};

    const getData: any = await this.releaseCapacitySubmissionService.findAll({
      contract_code_id: contractCode,
    });
    const resData = [];
    for (let i = 0; i < (getData?.data || []).length; i++) {
      if (getData?.data[i]?.entryData) {
        resData.push({ ...getData?.data[i]?.entryData });
      }
      if (getData?.data[i]?.exitData) {
        resData.push({ ...getData?.data[i]?.exitData });
      }
    }

    const formateData = await resData.map((e: any) => {
      const setData = {
        ['Point']: e['contract_point'],
        ['Entry / Exit']: e['entry_exit']?.['name'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date'], 'DD/MM/YYYY').format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date'], 'DD/MM/YYYY').format('DD/MM/YYYY')
          : null,
        ['Contracted (MMBTU/D)']:
          (!!e['contracted_mmbtu_d'] &&
            this.formatNumberThreeDecimal(e['contracted_mmbtu_d'])) ||
          null,
        ['Contracted (MMSCFD)']:
          (!!e['contracted_mmscfd'] &&
            this.formatNumberThreeDecimal(e['contracted_mmscfd'])) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      `Release Capacity Submission (${getData?.contract_code}`,
      true,
    );
  }

  async epCapacityReleaseCapacityManagement(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.release_capacity_submission.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        group: true,
        contract_code: {
          select: {
            id: true,
            contract_code: true,
          },
        },
        release_capacity_active: {
          include: {
            release_capacity_status: true,
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
        release_capacity_status: true,
        release_capacity_submission_detail: {
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
        release_capacity_submission_file: {
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
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Submission Time']: e['submission_time']
          ? dayjs(e['submission_time']).format('DD/MM/YYYY HH:mm')
          : null,
        ['Shipper Name']: e['group']?.['name'],
        ['Contract Code']: e['contract_code']?.['contract_code'],
        ['Status']: e['release_capacity_status']?.['name'],
        ['Reason']:
          (e['release_capacity_active'].length > 0 &&
            e['release_capacity_active']
              .map(
                (release_capacity_active: any) =>
                  release_capacity_active?.reasons,
              )
              .filter((f: any) => {
                return !!f;
              })
              .join(',')) ||
          null,
        // ['File']:
        //   (e['release_capacity_submission_file'].length > 0 &&
        //     e['release_capacity_submission_file']
        //       .map(
        //         (release_capacity_submission_file: any) =>
        //           `${release_capacity_submission_file?.url}`,
        //       )
        //       .join(',')) ||
        //   null,
        ['Requested Code']: e['requested_code'],
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Release Capacity Management',
      true,
    );
  }

  async epCapacityReleaseCapacityManagementDetail(
    response: Response,
    payload: any,
  ) {
    console.log(payload);
    const { data, filter } = payload || {};
    const sortedResData = data.sort(
      (a, b) => data.indexOf(a[0]) - data.indexOf(b[0]),
    );
    const formateData = sortedResData.flatMap((e: any) => {
      if (
        Array.isArray(e) &&
        e.length > 1 &&
        Array.isArray(e[1]) &&
        e[1].length > 0
      ) {
        const rowData = e[1].map((item: any) => {
          const setData = {
            ['Point']: item.temp_contract_point || null,
            ['Start Date']: item?.temp_start_date
              ? dayjs(item?.temp_start_date).format('DD/MM/YYYY')
              : null,
            ['End Date']: item?.temp_end_date
              ? dayjs(item?.temp_end_date).format('DD/MM/YYYY')
              : null,
            ['Contracted (MMBTU/D)']:
              (!!item?.total_contracted_mmbtu_d &&
                this.formatNumberThreeDecimal(
                  item?.total_contracted_mmbtu_d,
                )) ||
              null,
            ['Contracted (MMSCFD)']:
              (!!item?.total_contracted_mmscfd &&
                this.formatNumberThreeDecimal(item?.total_contracted_mmscfd)) ||
              null,
            ['Release (MMSCFD)']:
              (!!item?.total_release_mmscfd &&
                this.formatNumberThreeDecimal(item?.total_release_mmscfd)) ||
              null,
            ['Release (MMBTU/D)']:
              (!!item?.total_release_mmbtu_d &&
                this.formatNumberThreeDecimal(item?.total_release_mmbtu_d)) ||
              null,
          };

          const filteredData = Object.keys(setData)
            .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
            .reduce((obj, key) => {
              obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
              return obj;
            }, {});
          // filter
          return filteredData;
        });
        const total = e[1].reduce(
          (sum, item) => {
            const total_contracted_mmbtu_d = item?.total_contracted_mmbtu_d
              ? parseFloat(item?.total_contracted_mmbtu_d)
              : 0;
            const total_contracted_mmscfd = item?.total_contracted_mmscfd
              ? parseFloat(item?.total_contracted_mmscfd)
              : 0;
            const total_release_mmbtu_d = item?.total_release_mmbtu_d
              ? parseFloat(item?.total_release_mmbtu_d)
              : 0;
            const total_release_mmscfd = item?.total_release_mmscfd
              ? parseFloat(item?.total_release_mmscfd)
              : 0;
            return {
              total_contracted_mmbtu_d:
                sum.total_contracted_mmbtu_d + total_contracted_mmbtu_d,
              total_contracted_mmscfd:
                sum.total_contracted_mmscfd + total_contracted_mmscfd,
              total_release_mmbtu_d:
                sum.total_release_mmbtu_d + total_release_mmbtu_d,
              total_release_mmscfd:
                sum.total_release_mmscfd + total_release_mmscfd,
            };
          },
          {
            total_contracted_mmbtu_d: 0,
            total_contracted_mmscfd: 0,
            total_release_mmbtu_d: 0,
            total_release_mmscfd: 0,
          },
        );
        rowData.push({
          Point: 'Total',
          'Start Date': null,
          'End Date': null,
          'Contracted (MMBTU/D)': total.total_contracted_mmbtu_d
            ? this.formatNumberThreeDecimal(total.total_contracted_mmbtu_d)
            : null,
          'Contracted (MMSCFD)': total.total_contracted_mmscfd
            ? this.formatNumberThreeDecimal(total.total_contracted_mmscfd)
            : null,
          'Release (MMSCFD)': total.total_release_mmscfd
            ? this.formatNumberThreeDecimal(total.total_release_mmscfd)
            : null,
          'Release (MMBTU/D)': total.total_release_mmbtu_d
            ? this.formatNumberThreeDecimal(total.total_release_mmbtu_d)
            : null,
        });
        return rowData;
      }
      return [];
    });

    this.exportDataToExcelNew(
      formateData,
      response,
      'Release Capacity Management Submission Detail',
      true,
    );
  }

  async epCapacityReleaseUIOLISummary(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.release_summary.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        release_summary_comment: {
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
        group: true,
        contract_code: true,
        release_type: true,
        release_summary_detail: {
          include: {
            entry_exit: true,
            // booking_row_json:true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const newData = [];
    for (let i = 0; i < sortedResData.length; i++) {
      for (
        let isub = 0;
        isub < sortedResData[i]?.release_summary_detail.length;
        isub++
      ) {
        newData.push({
          ...sortedResData[i],
          dt: sortedResData[i]?.release_summary_detail[isub],
        });
      }
    }
    const formateData = await newData.map((e: any) => {
      let total_contracted_mmbtu_d = e['dt']?.['total_contracted_mmbtu_d'];
      let total_contracted_mmscfd = e['dt']?.['total_contracted_mmscfd'];
      let total_release_mmbtu_d = e['dt']?.['total_release_mmbtu_d'];
      let total_release_mmscfd = e['dt']?.['total_release_mmscfd'];
      if (
        total_contracted_mmbtu_d == 'null' ||
        total_contracted_mmbtu_d == 'undefined'
      ) {
        total_contracted_mmbtu_d = '';
      }
      if (
        total_contracted_mmscfd == 'null' ||
        total_contracted_mmscfd == 'undefined'
      ) {
        total_contracted_mmscfd = '';
      }
      if (
        total_release_mmbtu_d == 'null' ||
        total_release_mmbtu_d == 'undefined'
      ) {
        total_release_mmbtu_d = '';
      }
      if (
        total_release_mmscfd == 'null' ||
        total_release_mmscfd == 'undefined'
      ) {
        total_release_mmscfd = '';
      }
      const setData = {
        ['Release Start Date']: e['dt']?.['release_start_date']
          ? dayjs(e['dt']?.['release_start_date']).tz('Asia/Bangkok').format('DD/MM/YYYY')
          : null,
        ['Release End Date']: e['dt']?.['release_end_date']
          ? dayjs(e['dt']?.['release_end_date']).add(1, 'day').startOf('day').tz('Asia/Bangkok').format('DD/MM/YYYY')
          : null,
        ['Submitted Timestamp']: e['submitted_timestamp']
          ? dayjs(e['submitted_timestamp']).tz('Asia/Bangkok').format('DD/MM/YYYY HH:mm')
          : null,
        ['Contract Code']: e['contract_code']?.['contract_code'],
        ['Shipper Name']: e['group']?.['name'],
        ['Point']: e['dt']?.['temp_contract_point'],
        ['Contracted (MMBTU/D)']: total_contracted_mmbtu_d || '',
        ['Contracted (MMSCFD)']: total_contracted_mmscfd || '',
        ['Release (MMBTU/D)']: total_release_mmbtu_d || '',
        ['Release (MMSCFD)']: total_release_mmscfd || '',
        ['Comment']:
          (e['release_summary_comment'].length > 0 &&
            e['release_summary_comment']
              .map(
                (release_summary_comment: any) =>
                  release_summary_comment?.comments,
              )
              .filter((f: any) => {
                return !!f;
              })
              .join(',')) ||
          null,
        ['Type']: e['release_type']?.['name'],
      };
      console.log('setData  ', setData);
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    const mergeColumns = [
      'Release Start Date',
      'Release End Date',
      'Submitted Timestamp',
      'Contract Code',
      'Shipper Name'
    ];

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Release/UILIO Smmary Management',
      true,
      mergeColumns, // Enable cell merging
    );
  }

  async epCapacityUseItOrLoseIt(response: Response, payload: any) {
    let { filter } = payload;
    const header = filter;
    let maxDay: dayjs.Dayjs | undefined;
    header.map((item) => {
      const day = dayjs(item, 'MMM YYYY', true);
      if (day.isValid()) {
        if (maxDay == undefined || maxDay?.isBefore(day)) {
          maxDay = day;
        }
      }
      return item;
    });

    if (maxDay == undefined && payload?.maxDay) {
      const day = dayjs(payload?.maxDay, 'MMM YYYY', true);
      if (day.isValid()) {
        maxDay = day;
      }
    }

    const resData = await this.useItOrLoseItService.findAll2({
      startDate: maxDay.format('MM/YYYY'),
    });

    const newData = [];
    for (let i = 0; i < resData.length; i++) {
      for (let isub = 0; isub < resData[i]?.data.length; isub++) {
        const entryData = resData[i]?.data[isub]?.entryData?.value;
        const formattedDataEntry = entryData ? Object.entries(entryData).reduce((acc, [date, details]: any) => {
          acc[date] = details?.value; // ใช้ key เป็นวันที่ และ value เป็น "value" ใน object ด้านใน
          return acc;
        }, {}) : {};
        const entryData12Month = resData[i]?.data[isub]?.entryData?.valueBefor12Month;
        const formattedData12MonthEntry = entryData12Month ? Object.entries(entryData12Month).reduce((acc, [date, details]: any) => {
          acc[date] = details?.allocated_value; // ใช้ key เป็นวันที่ และ value เป็น "allocated_value" ใน object ด้านใน
          return acc;
        }, {}) : {};

        newData.push({
          ...resData[i],
          dt: resData[i]?.data[isub],
          etx: resData[i]?.data[isub]?.entryData,
          areaMock: resData[i]?.data[isub]?.entryData?.area_text,
          dates: formattedDataEntry,
          datesAllocated: formattedData12MonthEntry,
        });

        const formattedDataExit = Object.entries(
          resData[i]?.data[isub]?.exitData?.value,
        ).reduce((acc, [date, details]: any) => {
          acc[date] = details.value; // ใช้ key เป็นวันที่ และ value เป็น "value" ใน object ด้านใน
          return acc;
        }, {});

        const formattedData12MonthExit = Object.entries(
          resData[i]?.data[isub]?.exitData?.valueBefor12Month,
        ).reduce((acc, [date, details]: any) => {
          acc[date] = details.allocated_value; // ใช้ key เป็นวันที่ และ value เป็น "value" ใน object ด้านใน
          return acc;
        }, {});
        newData.push({
          ...resData[i],
          dt: resData[i]?.data[isub],
          etx: resData[i]?.data[isub]?.exitData,
          areaMock: resData[i]?.data[isub]?.exitData?.area_text,
          dates: formattedDataExit,
          datesAllocated: formattedData12MonthExit,
        });
      }
    }

    const usedCap = filter.find((f: any) => {
      return f === 'Used Cap (%)';
    });

    const formateData = await newData.map((e: any) => {
      // let dates = e['dates'];
      const datesAllocated = e['datesAllocated'];
      const newKeys = Object.keys(datesAllocated);
      if (usedCap) {
        // let newKeys = Object.keys(dates);
        filter = [...filter, ...newKeys];
      }

      const setData: any = {};
      header.map((item) => {
        if (item != 'Used Cap (%)') {
          setData[`${item}`] = undefined;
        }
      });
      setData['Shipper Name'] = e['group']?.['name'];
      setData['Contract Code'] = e['contract_code'];
      setData['Area'] = e['areaMock'];
      setData['Entry / Exit'] = e['etx']?.['entry_exit']?.['name'];
      const monthValues: number[] = [];
      // Object.keys(dates).map((key) => {
      //   const date = dayjs(key, 'DD/MM/YYYY').format('MMM YYYY');
      //   // // ลูกต้าให้ขึ้น 0 จนกว่าจะถึง Allocation Report
      //   // setData[`${date}`] = dates[`${key}`]
      //   setData[`${date}`] = '0.00';
      // });
      newKeys.map((key) => {
        const date = dayjs(key, 'DD/MM/YYYY').format('MMM YYYY');
        try {
          setData[`${date}`] = datesAllocated[`${key}`];
          monthValues.push(parseFloat(datesAllocated[`${key}`]) || 0);
        } catch (error) {
          setData[`${date}`] = datesAllocated[`${key}`];
        }
      });

      // Calculate average of all month values
      const allEmpty = monthValues.every((val) => val === 0);
      if (allEmpty || monthValues.length === 0) {
        setData['Average'] = '';
      } else {
        const average =
          monthValues.reduce((sum, val) => sum + val, 0) / monthValues.length;
        setData['Average'] = average; // Store as number, not formatted string
      }
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportCapacityUseItOrLoseIt(
      formateData,
      response,
      'Use It or Lose It',
      true,
    );
  }

  async exportCapacityUseItOrLoseIt(
    data: any[],
    response: Response,
    nameFile: string,
    skipFirstRow: boolean,
  ): Promise<void> {
    // ตรวจสอบว่ามีข้อมูลหรือไม่
    if (!data || data.length === 0) {
      response
        .status(400)
        .send({ message: 'Data is empty. Cannot generate Excel file.' });
    }

    // สร้าง workbook และ worksheet ใหม่
    const wb = XLSX.utils.book_new();
    const ws = skipFirstRow
      ? XLSX.utils.aoa_to_sheet([[]])
      : XLSX.utils.aoa_to_sheet([]);

    // Get all headers and identify month columns
    const allHeaders = Object.keys(data[0]);
    const basicHeaders = [
      'Shipper Name',
      'Contract Code',
      'Area',
      'Entry / Exit',
    ];
    const monthHeaders = allHeaders.filter(
      (h) =>
        !basicHeaders.includes(h) && h !== 'Used Cap (%)' && h !== 'Average',
    );

    // Create first header row (with merged "Used Cap (%)")
    const firstRow = [
      ...basicHeaders,
      'Used Cap (%)',
      ...new Array(monthHeaders.length).fill(''), // Empty cells for merging (including Average)
    ];

    // Create second header row (with individual month names + Average)
    const secondRow = [
      ...new Array(basicHeaders.length).fill(''), // Empty cells under basic headers
      ...monthHeaders,
      'Average',
    ];

    // Add headers
    const startRow = skipFirstRow ? 1 : 0;
    XLSX.utils.sheet_add_aoa(ws, [firstRow], { origin: startRow });
    XLSX.utils.sheet_add_aoa(ws, [secondRow], { origin: startRow + 1 });

    // Add data starting from row 3 (or 2 if not skipFirstRow)
    if (data.length > 0) {
      XLSX.utils.sheet_add_json(ws, data, {
        origin: startRow + 2,
        skipHeader: true,
      });
    }

    // Create merges array for header cells
    const merges = [];

    // Merge basic header cells vertically (span 2 rows)
    for (let i = 0; i < basicHeaders.length; i++) {
      merges.push({
        s: { r: startRow, c: i }, // start cell
        e: { r: startRow + 1, c: i }, // end cell
      });
    }

    // Merge "Used Cap (%)" horizontally across month columns + Average
    if (monthHeaders.length > 0) {
      merges.push({
        s: { r: startRow, c: basicHeaders.length }, // start at "Used Cap (%)"
        e: { r: startRow, c: basicHeaders.length + monthHeaders.length }, // end at Average (includes all months + Average)
      });
    }

    // Apply merges to worksheet
    ws['!merges'] = merges;

    // Apply center alignment and middle alignment to all header cells
    const headerRange = XLSX.utils.decode_range(ws['!ref']);
    for (let r = startRow; r <= startRow + 1; r++) {
      for (let c = 0; c < firstRow.length; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        if (ws[cellAddress]) {
          ws[cellAddress].s = {
            alignment: {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            },
            font: {
              bold: true,
            },
          };
        }
      }
    }

    // Apply 3 decimal place formatting to month columns and Average column
    const dataStartRow = startRow + 2;
    const dataRange = XLSX.utils.decode_range(ws['!ref']);
    for (let r = dataStartRow; r <= dataRange.e.r; r++) {
      for (
        let c = basicHeaders.length;
        c < basicHeaders.length + monthHeaders.length + 1;
        c++
      ) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        if (ws[cellAddress] && typeof ws[cellAddress].v === 'number') {
          ws[cellAddress].s = {
            numFmt: '#,##0.000', // 3 decimal places with thousands separator
            alignment: {
              horizontal: 'right',
              vertical: 'middle',
            },
          };
        }
      }
    }

    // ตรวจสอบว่า worksheet มีข้อมูลหรือไม่
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 0 || range.e.c < 0) {
      throw new Error('Worksheet is empty. Cannot generate Excel file.');
    }

    // เพิ่ม worksheet ลงใน workbook
    XLSX.utils.book_append_sheet(wb, ws, 'DataSheet');

    // ปรับความกว้างของคอลัมน์แบบไดนามิก
    const objectMaxLength = allHeaders.map((header) => header.length); // เริ่มต้นจากความยาวของ headers
    data.forEach((row) => {
      Object.keys(row).forEach((key, index) => {
        const columnLength = row[key] ? row[key].toString().length : 0;
        objectMaxLength[index] = Math.max(objectMaxLength[index], columnLength);
      });
    });

    // กำหนดความกว้างของคอลัมน์ให้พอดีกับ header และข้อมูล
    ws['!cols'] = objectMaxLength.map((maxLength) => {
      return { wch: Math.min(maxLength + 5, 30) }; // จำกัดความกว้างไม่เกิน 30
    });

    // ปรับ wrap text ในทุกเซลล์และจัดการขนาดแถวอัตโนมัติ
    ws['!rows'] = [];
    for (let R = range.s.r; R <= range.e.r; ++R) {
      let maxHeight = 20; // ค่าเริ่มต้นของความสูงแถว
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        // ตรวจสอบว่ามีข้อความในเซลล์หรือไม่
        if (ws[cellAddress].v && typeof ws[cellAddress].v === 'string') {
          // เปิดการ wrapText และจัดให้ align ซ้ายและด้านบน
          ws[cellAddress].s = {
            alignment: {
              wrapText: true, // เปิดการ wrapText ที่นี่
              vertical: 'top',
              horizontal: 'left',
            },
          };
        }

        const cellText = ws[cellAddress].v ? ws[cellAddress].v.toString() : '';
        const lines = Math.ceil(cellText.length / 30); // คำนวณจำนวนบรรทัด
        maxHeight = Math.max(maxHeight, lines * 15); // เพิ่มความสูงตามจำนวนบรรทัด
      }
      ws['!rows'][R] = { hpx: maxHeight }; // ปรับความสูงของแถวตามจำนวนบรรทัด
    }

    ws['!rows'][0] = { hidden: true };

    // Object.keys(ws).forEach((cell) => {
    //   const rowNumber = parseInt(cell.replace(/[^0-9]/g, '')); // ดึงเลขแถวออกมา
    //   const columnLetter = cell.replace(/[0-9]/g, '');

    //   if (
    //     ws[cell] &&
    //     typeof ws[cell] === 'object' &&
    //     cell[0] !== '!'
    //   ) {
    //     ws[cell].z = '@'; // ใช้รูปแบบ '@' เพื่อระบุว่าเป็น Text
    //     ws[cell].t = 's';

    //     // ✅ ถ้า row 2 และเซลล์มีข้อมูล ให้ใส่สีพื้นหลังดำและข้อความสีขาว
    //     if (rowNumber === 2 && ws[cell].v) {
    //       ws[cell].s = ws[cell].s || {}; // ตรวจสอบว่าเซลล์มี object style หรือไม่
    //       ws[cell].s.fill = {
    //         patternType: 'solid', // ✅ เติมสีพื้นหลังแบบทึบ
    //         fgColor: { rgb: '000000' }, // ✅ สีพื้นหลังดำ (Black)
    //       };
    //       ws[cell].s.font = {
    //         color: { rgb: 'FFFFFF' }, // ✅ สีข้อความเป็นสีขาว (White)
    //         bold: true, // ✅ ทำให้ตัวอักษรหนา
    //       };
    //     }
    //     // ✅ ค้นหาแถวสุดท้ายที่มีข้อมูล
    //     const lastRowWithData = Math.max(
    //       ...Object.keys(ws)
    //         .map((c) => parseInt(c.replace(/[^0-9]/g, ''), 10))
    //         .filter((n) => !isNaN(n)),
    //     );
    //     // ✅ ตั้งค่าขอบเขต (Border) สำหรับทุกเซลล์ตั้งแต่แถวที่ 5 เป็นต้นไป
    //     if (rowNumber >= 2) {
    //       ws[cell].s = ws[cell].s || {};
    //       ws[cell].s.border = ws[cell].s.border || {};

    //       // ✅ ใส่เส้นแนวตั้ง (ทุกแถว)
    //       ws[cell].s.border.left = { style: 'thin' };
    //       ws[cell].s.border.right = { style: 'thin' };

    //       // ✅ ใส่เส้นแนวนอนเฉพาะแถวสุดท้ายที่มีข้อมูล
    //       if (rowNumber === lastRowWithData) {
    //         ws[cell].s.border.bottom = { style: 'thin' };
    //       }
    //     }
    //   }
    // });

    // ตรวจสอบว่า workbook มีข้อมูลหรือไม่
    if (!wb.SheetNames.length) {
      throw new Error('Workbook is empty. Cannot generate Excel file.');
    }

    // เขียนไฟล์ Excel ลงใน Buffer
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    // กำหนดการดาวน์โหลดไฟล์ Excel
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD HH:mm')}_${nameFile}.xlsx"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(excelBuffer);
  }

  async epCapacityReserveBalancingGasContracts(
    response: Response,
    payload: any,
  ) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.reserve_balancing_gas_contract.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        group: true,
        reserve_balancing_gas_contract_comment: {
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
          orderBy: { id: 'desc' },
        },
        reserve_balancing_gas_contract_files: {
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
          orderBy: { id: 'desc' },
        },
        reserve_balancing_gas_contract_detail: {
          include: {
            zone: true,
            area: true,
            entry_exit: true,
            nomination_point: true,
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
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );

    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Reserve Bal. Contract Code']: e['res_bal_gas_contract'],
        ['Shipper Name']: e['group']?.['name'],
        ['Comment']:
          (e['reserve_balancing_gas_contract_comment'].length > 0 &&
            e['reserve_balancing_gas_contract_comment']
              .map(
                (reserve_balancing_gas_contract_comment: any) =>
                  `${reserve_balancing_gas_contract_comment?.comment}`,
              )
              .join(',')) ||
          null,
        ['File']:
          (e['reserve_balancing_gas_contract_files'].length > 0 &&
            e['reserve_balancing_gas_contract_files']
              .map(
                (reserve_balancing_gas_contract_files: any) =>
                  `${reserve_balancing_gas_contract_files?.url}`,
              )
              .join(',')) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Reserve Balancing Gas Contracts',
      true,
    );
  }

  async epCapacityPathManagement(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    console.log('[...(idArray || []).map((idN: any) => Number(idN))] : ', [
      ...(idArray || []).map((idN: any) => Number(idN)),
    ]);
    const resData = await this.prisma.path_management.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        path_management_config: {
          where: { flag_use: true },
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
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );

    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Version']: e['version'],
        ['Activate Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Path Management',
      true,
    );
  }

  async epCapacityViewPathManagement(response: Response, payload: any) {
    const { id, filter, idSub } = payload || {};

    // const groupPath = await this.pathManagementService.groupPath()
    // console.log('groupPath : ', groupPath);
    const pathManagementOnceFull =
      await this.pathManagementService.pathManagementOnceFull(id);

    console.log('pathManagementOnceFull : ', pathManagementOnceFull);

    let pathConvert = pathManagementOnceFull?.path_management_config.map(
      (e: any) => {
        const convert = this.safeParseJSON(e?.['temps']);
        const pathData = {
          revised_capacity_path: convert?.revised_capacity_path,
          revised_capacity_path_edges: convert?.revised_capacity_path_edges,
        };
        const resultNodeEdges = this.createNodeEdges(
          pathData?.revised_capacity_path,
          pathData?.revised_capacity_path_edges,
        );
        // nodes
        const newStringNodeChain = resultNodeEdges?.nodes
          .map((n: any) => {
            return n?.name;
          })
          .join(' -> ');

        return { exit: e['exit_name_temp'], newStringNodeChain };
      },
    );

    console.log('pathConvert : ', pathConvert);
    // pathConvert = pathConvert.filter((ff:any) => { return ff?.exit === idSub })
    pathConvert = pathConvert.filter((ff: any) =>
      (idSub || []).includes(ff.exit),
    );

    console.log('idSub : ', idSub);
    console.log('pathConvert : ', pathConvert);

    const formateData = await pathConvert.map((e: any) => {
      const setData = {
        ['Exit']: e['exit'],
        ['Default Capacity Path']: e['newStringNodeChain'],
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      `View Path Management ${pathManagementOnceFull?.version}`,
      true,
    );
  }

  // Planning
  async epPlanningPlanningFileSubmissionTemplate(
    response: Response,
    payload: any,
  ) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData =
      await this.prisma.planning_file_submission_template.findMany({
        where: {
          id: {
            in: [...(idArray || []).map((idN: any) => Number(idN))],
          },
        },
        include: {
          term_type: true,
          group: true,
          planning_file_submission_template_nom: {
            include: {
              nomination_point: true,
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
        orderBy: { id: 'desc' },
      });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Term']: e['term_type']?.['name'],
        ['Shipper Name']: e['group']?.['name'],
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Planning File Submissiom Template',
      true,
    );
  }

  async epPlanningQueryShippersPlanningFiles(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.query_shipper_planning_files.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        term_type: true,
        group: {
          select: {
            id: true,
            id_name: true,
            name: true,
            company_name: true,
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
        query_shipper_planning_files_file: {
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
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Term']: e['term_type']?.['name'],
        ['Planning Code']: e['planning_code'],
        // ['File']:
        //   (e['query_shipper_planning_files_file'].length > 0 &&
        //     e['query_shipper_planning_files_file']
        //       .map(
        //         (query_shipper_planning_files_file: any) =>
        //           `${query_shipper_planning_files_file?.url}`,
        //       )
        //       .join(',')) ||
        //   null,
        ['Shipper Name']: e['group']?.['name'],
        ['Shipper File Submission Date']: e['shipper_file_submission_date']
          ? dayjs(e['shipper_file_submission_date']).format('DD/MM/YYYY')
          : null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Query Shippers Planning Files',
      true,
    );
  }

  async epPlanningNewPoint(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.newpoint.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        term_type: true,
        group: {
          select: {
            id: true,
            id_name: true,
            name: true,
            company_name: true,
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
        newpoint_file: {
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
        newpoint_detail: {
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
      },
      orderBy: { id: 'desc' },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Term']: e['term_type']?.['name'],
        ['Planning Code']: e['planning_code'],
        ['Shipper Name']: e['group']?.['name'],
        ['Point']:
          (e['newpoint_detail'].length > 0 &&
            e['newpoint_detail']
              .map((newpoint_detail: any) => `${newpoint_detail?.point}`)
              .join(',')) ||
          null,
        // ['File']:
        //   (e['newpoint_file'].length > 0 &&
        //     e['newpoint_file']
        //       .map((newpoint_file: any) => `${newpoint_file?.url}`)
        //       .join(',')) ||
        //   null,
        ['Submitted Timestamp']: e['shipper_file_submission_date']
          ? dayjs(e['shipper_file_submission_date']).format('DD/MM/YYYY')
          : null,
        ['Start Date']: e['start_date']
          ? dayjs(e['start_date']).format('DD/MM/YYYY')
          : null,
        ['End Date']: e['end_date']
          ? dayjs(e['end_date']).format('DD/MM/YYYY')
          : null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(formateData, response, 'New Point', true);
  }

  async epNominationUploadTemplateForShipper(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.prisma.upload_template_for_shipper.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        nomination_type: true,
        group: true,
        contract_code: true,
        upload_template_for_shipper_comment: {
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
        },
        upload_template_for_shipper_file: {
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Shipper Name']: e['group']?.['name'],
        ['Contract Code']: e['contract_code']?.['contract_code'],
        ['Document Type']: e['nomination_type']?.['document_type'],
        // ['File']: //https://app.clickup.com/t/86etzcgvh
        //   (e['upload_template_for_shipper_file'].length > 0 &&
        //     e['upload_template_for_shipper_file']
        //       .map(
        //         (upload_template_for_shipper_file: any) =>
        //           `${upload_template_for_shipper_file?.url}`,
        //       )
        //       .join(',')) ||
        //   null,
        ['File']:
          (e['upload_template_for_shipper_file'].length > 0 &&
            e['upload_template_for_shipper_file'][0]?.url) ||
          null,
        ['Comment']:
          (e['upload_template_for_shipper_comment'].length > 0 &&
            e['upload_template_for_shipper_comment']
              .map(
                (upload_template_for_shipper_comment: any) =>
                  `${upload_template_for_shipper_comment?.comment}`,
              )
              .join('\n')) ||
          null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm:ss') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm:ss') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Upload Template For Shipper',
      true,
    );
  }

  async epNominationQueryShipperNominationFile(
    response: Response,
    payload: any,
  ) {
    const { id, filter } = payload || {};
    const idArray = id;

    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: true,
        submission_comment_query_shipper_nomination_file: true,
        nomination_type: true,
        nomination_version: {
          include: {
            nomination_full_json: true,
            nomination_full_json_sheet2: true,
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
        query_shipper_nomination_file_renom: true,
        query_shipper_nomination_file_url: {
          include: {
            nomination_version: true,
            query_shipper_nomination_status: true,
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
        },
        query_shipper_nomination_file_comment: {
          include: {
            query_shipper_nomination_type_comment: true,
            query_shipper_nomination_status: true,
            nomination_version: true,
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
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      // 32767
      const lengthSubmission =
        (e['submission_comment_query_shipper_nomination_file'].length > 0 &&
          e['submission_comment_query_shipper_nomination_file']
            .map(
              (submission_comment_query_shipper_nomination_file: any) =>
                `${submission_comment_query_shipper_nomination_file?.remark}`,
            )
            .join(',')) ||
        '';
      // ['Submission Comment']: lengthSubmission.length > 32767 ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ' : lengthSubmission,

      const setData = {
        ['Status']: e['query_shipper_nomination_status']?.['name'],
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Gas Week']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Shipper Name']: e['group']?.['name'],
        ['Contract Code']: e['contract_code']?.['contract_code'],
        ['Document Type']: e['nomination_type']?.['document_type'],
        ['File Name']:
          (!!e['query_shipper_nomination_file_url'][0]['url'] &&
            this.cutUploadFileName(
              e['query_shipper_nomination_file_url'][0]['url'],
            )) ||
          null,
        ['Submission Comment']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission,
        ['File']:
          (e['query_shipper_nomination_file_url'].length > 0 &&
            e['query_shipper_nomination_file_url']
              .map(
                (query_shipper_nomination_file_url: any) =>
                  `${query_shipper_nomination_file_url?.url}`,
              )
              .join(',')) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Query Shipper Nomination File',
      true,
    );
  }

  async epNominationDailyAdjustmentSummary(response: Response, payload: any) {
    const { checkAdjustment, startDate, endDate, contractCode, filter } =
      payload;

    // const resData = await this.dailyAdjustmentService.dailyAdjustmentSummary(
    //   { checkAdjustment, startDate, endDate, contractCode },
    //   null,
    // );
    const resData = await this.dailyAdjustmentService.dailyAdjustmentSummary2(
      { checkAdjustment, startDate, endDate, contractCode },
      null,
    );

    console.log('------ resData : ', resData);

    const formateData = await resData.map((e: any) => {
      const setData = {
        ['Gas Day']: e['gasDayUse'],
        ['Nominations Code']: e['nomination_code'],
        ['Entry/Exit']: e['entryExit'],
        ['Adjustment']: e['adjustment'],
        ['Contract Code']: e['contract'],
        ['Shipper Name']: e['shipper_name'],
        ['Nomination Point']: e['point'],
        ['H1 00:00 - 01:00']:
          (!!e['H1'] && this.formatNumberThreeDecimal(e['H1'])) || null,
        ['H2 01:01 - 02:00']:
          (!!e['H2'] && this.formatNumberThreeDecimal(e['H2'])) || null,
        ['H3 02:01 - 03:00']:
          (!!e['H3'] && this.formatNumberThreeDecimal(e['H3'])) || null,
        ['H4 03:01 - 04:00']:
          (!!e['H4'] && this.formatNumberThreeDecimal(e['H4'])) || null,
        ['H5 04:01 - 05:00']:
          (!!e['H5'] && this.formatNumberThreeDecimal(e['H5'])) || null,
        ['H6 05:01 - 06:00']:
          (!!e['H6'] && this.formatNumberThreeDecimal(e['H6'])) || null,
        ['H7 06:01 - 07:00']:
          (!!e['H7'] && this.formatNumberThreeDecimal(e['H7'])) || null,
        ['H8 07:01 - 08:00']:
          (!!e['H8'] && this.formatNumberThreeDecimal(e['H8'])) || null,
        ['H9 08:01 - 09:00']:
          (!!e['H9'] && this.formatNumberThreeDecimal(e['H9'])) || null,
        ['H10 09:01 - 10:00']:
          (!!e['H10'] && this.formatNumberThreeDecimal(e['H10'])) || null,
        ['H11 10:01 - 11:00']:
          (!!e['H11'] && this.formatNumberThreeDecimal(e['H11'])) || null,
        ['H12 11:01 - 12:00']:
          (!!e['H12'] && this.formatNumberThreeDecimal(e['H12'])) || null,
        ['H13 12:01 - 13:00']:
          (!!e['H13'] && this.formatNumberThreeDecimal(e['H13'])) || null,
        ['H14 13:01 - 14:00']:
          (!!e['H14'] && this.formatNumberThreeDecimal(e['H14'])) || null,
        ['H15 14:01 - 15:00']:
          (!!e['H15'] && this.formatNumberThreeDecimal(e['H15'])) || null,
        ['H16 15:01 - 16:00']:
          (!!e['H16'] && this.formatNumberThreeDecimal(e['H16'])) || null,
        ['H17 16:01 - 17:00']:
          (!!e['H17'] && this.formatNumberThreeDecimal(e['H17'])) || null,
        ['H18 17:01 - 18:00']:
          (!!e['H18'] && this.formatNumberThreeDecimal(e['H18'])) || null,
        ['H19 18:01 - 19:00']:
          (!!e['H19'] && this.formatNumberThreeDecimal(e['H19'])) || null,
        ['H20 19:01 - 20:00']:
          (!!e['H20'] && this.formatNumberThreeDecimal(e['H20'])) || null,
        ['H21 20:01 - 21:00']:
          (!!e['H21'] && this.formatNumberThreeDecimal(e['H21'])) || null,
        ['H22 21:01 - 22:00']:
          (!!e['H22'] && this.formatNumberThreeDecimal(e['H22'])) || null,
        ['H23 22:01 - 23:00']:
          (!!e['H23'] && this.formatNumberThreeDecimal(e['H23'])) || null,
        ['H24 23:01 - 24:00']:
          (!!e['H24'] && this.formatNumberThreeDecimal(e['H24'])) || null,
        ['Total']: this.formatNumberThreeDecimal(e['totalH1ToH24Adjust']),
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Quality Planning',
      true,
    );
  }

  // sunday
  // monday
  // tuesday
  // wednesday
  // thursday
  // friday
  // saturday
  async epNominationShipperNominationReport(response: Response, payload: any) {
    const { id, key, day, filter } = payload || {};
    // ถ้าใส่ key 2 ให้ ใส่มาด้วย // sunday // monday // tuesday // wednesday // thursday // friday // saturday
    const idArray = id;
    const resData1 =
      await this.queryShipperNominationFileService.shipperNominationReport();
    function filterByIds<T extends { id: any }>(items: T[], ids: any[]): T[] {
      return items.filter((item) => ids.includes(item.id));
    }

    // ใช้งาน
    const resData = filterByIds(resData1, idArray);

    // const resData = resDataMas?.filter()

    // const resData = await this.prisma.query_shipper_nomination_file.findMany({
    //   where: {
    //     id: {
    //       in: [...(idArray || []).map((idN: any) => Number(idN))],
    //     },
    //     AND: [
    //       {
    //         OR: [{ del_flag: false }, { del_flag: null }],
    //       },
    //     ],
    //   },
    //   include: {
    //     group: true,
    //     query_shipper_nomination_status: true,
    //     contract_code: true,
    //     submission_comment_query_shipper_nomination_file: true,
    //     nomination_type: true,
    //     nomination_version: {
    //       include: {
    //         nomination_full_json: true,
    //         nomination_full_json_sheet2: true,
    //         nomination_row_json: {
    //           include: {
    //             query_shipper_nomination_type: true,
    //           },
    //           orderBy: {
    //             id: 'asc',
    //           },
    //         },
    //       },
    //       where: {
    //         flag_use: true,
    //       },
    //     },
    //     query_shipper_nomination_file_renom: true,
    //     query_shipper_nomination_file_url: {
    //       include: {
    //         nomination_version: true,
    //         query_shipper_nomination_status: true,
    //         create_by_account: {
    //           select: {
    //             id: true,
    //             email: true,
    //             first_name: true,
    //             last_name: true,
    //           },
    //         },
    //         update_by_account: {
    //           select: {
    //             id: true,
    //             email: true,
    //             first_name: true,
    //             last_name: true,
    //           },
    //         },
    //       },
    //       orderBy: {
    //         id: 'desc',
    //       },
    //     },
    //     query_shipper_nomination_file_comment: {
    //       include: {
    //         query_shipper_nomination_type_comment: true,
    //         query_shipper_nomination_status: true,
    //         nomination_version: true,
    //         create_by_account: {
    //           select: {
    //             id: true,
    //             email: true,
    //             first_name: true,
    //             last_name: true,
    //           },
    //         },
    //         update_by_account: {
    //           select: {
    //             id: true,
    //             email: true,
    //             first_name: true,
    //             last_name: true,
    //           },
    //         },
    //       },
    //       orderBy: {
    //         id: 'desc',
    //       },
    //     },
    //   },
    //   orderBy: {
    //     id: 'desc',
    //   },
    // });

    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    // console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Gas Day']:
          key === 2 ? e['weeklyDay'][day]['gas_day_text'] : e['gas_day_text'],
        ['Shipper Name']: e['shipper_name'],
        ['Capacity Right (MMBTU/D)']:
          key === 2
            ? this.formatNumberFDecimal(
              e['weeklyDay'][day]['capacityRightMMBTUD'],
            )
            : this.formatNumberFDecimal(e['capacityRightMMBTUD']),
        ['Nominated Value (MMBTU/D)']:
          key === 2
            ? this.formatNumberFDecimal(
              e['weeklyDay'][day]['nominatedValueMMBTUD'],
            )
            : this.formatNumberFDecimal(e['nominatedValueMMBTUD']),
        ['Overusage (MMBTU/D)']:
          key === 2
            ? this.formatNumberFDecimal(e['weeklyDay'][day]['overusageMMBTUD'])
            : this.formatNumberFDecimal(
              this.formatNumberFDecimal(e['overusageMMBTUD']),
            ),
        ['Imbalance (MMBTU/D)']:
          key === 2
            ? this.formatNumberFDecimal(e['weeklyDay'][day]['imbalanceMMBTUD'])
            : this.formatNumberFDecimal(e['imbalanceMMBTUD']),
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Daily Management',
      true,
    );
  }

  async epNominationDailyManagement(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;

    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: true,
        submission_comment_query_shipper_nomination_file: true,
        nomination_type: true,
        nomination_version: {
          include: {
            nomination_full_json: true,
            nomination_full_json_sheet2: true,
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
        query_shipper_nomination_file_renom: true,
        query_shipper_nomination_file_url: {
          include: {
            nomination_version: true,
            query_shipper_nomination_status: true,
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
        },
        query_shipper_nomination_file_comment: {
          include: {
            query_shipper_nomination_type_comment: true,
            query_shipper_nomination_status: true,
            nomination_version: true,
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
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      // 32767
      const lengthSubmission =
        (e['submission_comment_query_shipper_nomination_file'].length > 0 &&
          e['submission_comment_query_shipper_nomination_file']
            .map(
              (submission_comment_query_shipper_nomination_file: any) =>
                `${submission_comment_query_shipper_nomination_file?.remark}`,
            )
            .join('\n')) ||
        '';
      // ['Submission Comment']: lengthSubmission.length > 32767 ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ' : lengthSubmission,
      const setData = {
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Nomination Code']: e['nomination_code'],
        ['Renominations']: e['query_shipper_nomination_file_renom']?.['name'],
        ['Status']: e['query_shipper_nomination_status']?.['name'],
        ['Version']:
          (!!e['nomination_version'][0]['version'] &&
            e['nomination_version'][0]['version']) ||
          null,
        ['Contract Code']: e['contract_code']?.['contract_code'],
        ['Shipper Name']: e['group']?.['name'],
        ['Submitted Timestamp']: e['submitted_timestamp']
          ? dayjs(e['submitted_timestamp']).format('DD/MM/YYYY HH:mm')
          : '',
        ['Submission Comment']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission,
        ['Comment']:
          (e['query_shipper_nomination_file_comment'].length > 0 &&
            e['query_shipper_nomination_file_comment']
              .map(
                (query_shipper_nomination_file_comment: any) =>
                  `${query_shipper_nomination_file_comment?.remark}`,
              )
              .join(',')) ||
          null,
        ['Shipper File']:
          (e['query_shipper_nomination_file_url'].length > 0 &&
            e['query_shipper_nomination_file_url']
              .map(
                (query_shipper_nomination_file_url: any) =>
                  `${query_shipper_nomination_file_url?.url}`,
              )
              .join(',')) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Daily Management',
      true,
    );
  }

  async epNominationWeeklyManagement(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;

    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: true,
        submission_comment_query_shipper_nomination_file: true,
        nomination_type: true,
        nomination_version: {
          include: {
            nomination_full_json: true,
            nomination_full_json_sheet2: true,
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
        query_shipper_nomination_file_renom: true,
        query_shipper_nomination_file_url: {
          include: {
            nomination_version: true,
            query_shipper_nomination_status: true,
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
        },
        query_shipper_nomination_file_comment: {
          include: {
            query_shipper_nomination_type_comment: true,
            query_shipper_nomination_status: true,
            nomination_version: true,
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
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      // 32767
      const lengthSubmission =
        (e['submission_comment_query_shipper_nomination_file'].length > 0 &&
          e['submission_comment_query_shipper_nomination_file']
            .map(
              (submission_comment_query_shipper_nomination_file: any) =>
                `${submission_comment_query_shipper_nomination_file?.remark}`,
            )
            .join('\n')) ||
        '';
      // ['Submission Comment']: lengthSubmission.length > 32767 ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ' : lengthSubmission,
      const setData = {
        ['Gas Week']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Nomination Code']: e['nomination_code'],
        ['Renominations']: e['query_shipper_nomination_file_renom']?.['name'],
        ['Status']: e['query_shipper_nomination_status']?.['name'],
        ['Version']:
          (!!e['nomination_version'][0]['version'] &&
            e['nomination_version'][0]['version']) ||
          null,
        ['Contract Code']: e['contract_code']?.['contract_code'],
        ['Shipper Name']: e['group']?.['name'],
        ['Submitted Timestamp']: e['submitted_timestamp']
          ? dayjs(e['submitted_timestamp']).format('DD/MM/YYYY HH:mm')
          : '',
        ['Submission Comment']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission,
        ['Comment']:
          (e['query_shipper_nomination_file_comment'].length > 0 &&
            e['query_shipper_nomination_file_comment']
              .map(
                (query_shipper_nomination_file_comment: any) =>
                  `${query_shipper_nomination_file_comment?.remark}`,
              )
              .join(',')) ||
          null,
        ['Shipper File']:
          (e['query_shipper_nomination_file_url'].length > 0 &&
            e['query_shipper_nomination_file_url']
              .map(
                (query_shipper_nomination_file_url: any) =>
                  `${query_shipper_nomination_file_url?.url}`,
              )
              .join(',')) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Weekly Management',
      true,
    );
  }

  async epNominationDailyAdjustment(response: Response, payload: any) {
    const { id, filter } = payload || {};
    const idArray = id;

    const resData = await this.prisma.daily_adjustment.findMany({
      where: {
        id: {
          in: [...(idArray || []).map((idN: any) => Number(idN))],
        },
      },
      include: {
        daily_adjustment_group: {
          include: {
            group: {
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
          },
        },
        daily_adjustment_nom: {
          include: {
            nomination_point: true,
          },
        },
        daily_adjustment_status: true,
        daily_adjustment_reason: {
          include: {
            daily_adjustment_status: true,
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
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Status']: e['daily_adjustment_status']?.['name'],
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Time']: e['time'],
        ['Daily Adjustment Code']: e['daily_code'],
        ['Shipper Name']:
          (e['daily_adjustment_group'].length > 0 &&
            e['daily_adjustment_group']
              .map(
                (daily_adjustment_group: any) =>
                  `${daily_adjustment_group?.group?.name}`,
              )
              .join(',')) ||
          null,
        ['Reasons']:
          (e['daily_adjustment_reason'].length > 0 &&
            e['daily_adjustment_reason']
              .map(
                (daily_adjustment_reason: any) =>
                  `${daily_adjustment_reason?.reason}`,
              )
              .join(',')) ||
          null,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Daily Adjustment',
      true,
    );
  }

  async epNominationQualityEvaluation(response: Response, payload: any) {
    const { gasday, type, filter } = payload || {};

    const resData = await this.qualityEvaluationService.findAll();
    const restype = type === 1 ? resData?.newDaily : resData?.newWeekly;

    // "gasday": "01/04/2025"
    let nrestype = [];
    let gasdayjs: dayjs.Dayjs | undefined;
    if (gasday) {
      nrestype = restype.filter((f: any) => {
        return f?.gasday === gasday;
      });
      gasdayjs = dayjs(gasday, 'DD/MM/YYYY');
    } else {
      nrestype = restype;
    }

    const formateData = await nrestype.map((e: any) => {
      const setData = {
        ['Gas Day']: e?.['gasday'] || '',
        ['Zone']: e?.['zone']?.['name'] || '',
        ['Area']: e?.['area']?.['name'] || '',
        ['Parameter']: e?.['parameter'] || '',
        ['Value (BTU/SCF)']:
          (!!e['valueBtuScf'] &&
            this.formatNumberThreeDecimal(e['valueBtuScf'])) ||
          null,
        ['Sunday']:
          (!!e['sunday']?.['value'] &&
            this.formatNumberThreeDecimal(e['sunday']?.['value'])) ||
          null,
        ['Monday']:
          (!!e['monday']?.['value'] &&
            this.formatNumberThreeDecimal(e['monday']?.['value'])) ||
          null,
        ['Tuesday']:
          (!!e['tuesday']?.['value'] &&
            this.formatNumberThreeDecimal(e['tuesday']?.['value'])) ||
          null,
        ['Wednesday']:
          (!!e['wednesday']?.['value'] &&
            this.formatNumberThreeDecimal(e['wednesday']?.['value'])) ||
          null,
        ['Thursday']:
          (!!e['thursday']?.['value'] &&
            this.formatNumberThreeDecimal(e['thursday']?.['value'])) ||
          null,
        ['Friday']:
          (!!e['friday']?.['value'] &&
            this.formatNumberThreeDecimal(e['friday']?.['value'])) ||
          null,
        ['Saturday']:
          (!!e['saturday']?.['value'] &&
            this.formatNumberThreeDecimal(e['saturday']?.['value'])) ||
          null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          let displayKey = key;
          if (key.includes('day') && gasdayjs && gasdayjs.isValid()) {
            switch (key) {
              case 'Sunday':
                displayKey = `Sunday ${gasdayjs.format('DD/MM/YYYY')}`;
                break;
              case 'Monday':
                displayKey = `Monday ${gasdayjs.add(1, 'day').format('DD/MM/YYYY')}`;
                break;
              case 'Tuesday':
                displayKey = `Tuesday ${gasdayjs.add(2, 'day').format('DD/MM/YYYY')}`;
                break;
              case 'Wednesday':
                displayKey = `Wednesday ${gasdayjs.add(3, 'day').format('DD/MM/YYYY')}`;
                break;
              case 'Thursday':
                displayKey = `Thursday ${gasdayjs.add(4, 'day').format('DD/MM/YYYY')}`;
                break;
              case 'Friday':
                displayKey = `Friday ${gasdayjs.add(5, 'day').format('DD/MM/YYYY')}`;
                break;
              case 'Saturday':
                displayKey = `Saturday ${gasdayjs.add(6, 'day').format('DD/MM/YYYY')}`;
              default:
                break;
            }
          }
          obj[displayKey] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Quality Evaluation',
      true,
    );
  }

  async epNominationQualityPlanning(response: Response, payload: any) {
    const { gasday, type, filter } = payload || {};

    const resData = await this.qualityPlanningService.findAll();
    const restype =
      type === 1
        ? resData?.newDaily
        : type === 2
          ? resData?.newWeekly
          : resData?.intraday;

    // "gasday": "01/04/2025"
    console.log('gasday : ', gasday);
    console.log('restype : ', restype);
    let nrestype = [];
    let gasdayjs: dayjs.Dayjs | undefined;
    if (gasday) {
      // nrestype = restype.filter((f: any) => {
      //   return f?.gasday === gasday;
      // });
      gasdayjs = dayjs(gasday, 'DD/MM/YYYY');
    } else {
      //   nrestype = restype;
    }

    function getNext7Days(startDateStr: string): string[] {
      const startDate = getTodayNowDDMMYYYYDfaultAdd7(startDateStr);

      const result = [];
      for (let i = 0; i < 7; i++) {
        result.push(startDate.add(i, 'day').format('DD/MM/YYYY'));
      }

      return result;
    }

    function getPrev7Days(startDateStr: string): string[] {
      const startDate = getTodayNowDDMMYYYYDfaultAdd7(startDateStr);

      const result = [];
      for (let i = 0; i < 7; i++) {
        result.push(startDate.subtract(i, 'day').format('DD/MM/YYYY'));
      }

      return result;
    }

    if (type === 1) {
      const next7 = getNext7Days(gasday);
      nrestype = restype.filter((f: any) => {
        return next7.includes(f?.gasday);
      });
    } else if (type === 2) {
      const prev7 = getPrev7Days(gasday);
      nrestype = restype.filter((f: any) => {
        return prev7.includes(f?.gasday);
      });
    } else {
      nrestype = restype;
    }

    // const FMT = 'DD/MM/YYYY';
    // const sorted_nrestype = _.orderBy(
    //   nrestype,
    //   [(r) => dayjs(r.gasday, FMT).valueOf(), (r) => r.area?.name ?? ''],
    //   ['desc', 'asc']
    // );

    // console.log('nrestype : ', nrestype);
    // console.log('sorted_nrestype : ', sorted_nrestype);
    const formateData = await nrestype.map((e: any) => {
      const setData = {
        ['Gas Day']: e?.['gasday'] || '',
        ['Zone']: e?.['zone']?.['name'] || '',
        ['Area']: e?.['area']?.['name'] || '',
        ['Parameter']: e?.['parameter'] || '',
        ['Value (BTU/SCF)']:
          (!!e['valueBtuScf'] &&
            this.formatNumberThreeDecimal(e['valueBtuScf'])) ||
          null,
        [`Sunday ${e['sunday']?.['date']}`]:
          (!!e['sunday']?.['value'] &&
            this.formatNumberThreeDecimal(e['sunday']?.['value'])) ||
          null,
        [`Monday ${e['monday']?.['date']}`]:
          (!!e['monday']?.['value'] &&
            this.formatNumberThreeDecimal(e['monday']?.['value'])) ||
          null,
        [`Tuesday ${e['tuesday']?.['date']}`]:
          (!!e['tuesday']?.['value'] &&
            this.formatNumberThreeDecimal(e['tuesday']?.['value'])) ||
          null,
        [`Wednesday ${e['wednesday']?.['date']}`]:
          (!!e['wednesday']?.['value'] &&
            this.formatNumberThreeDecimal(e['wednesday']?.['value'])) ||
          null,
        [`Thursday ${e['thursday']?.['date']}`]:
          (!!e['thursday']?.['value'] &&
            this.formatNumberThreeDecimal(e['thursday']?.['value'])) ||
          null,
        [`Friday ${e['friday']?.['date']}`]:
          (!!e['friday']?.['value'] &&
            this.formatNumberThreeDecimal(e['friday']?.['value'])) ||
          null,
        [`Saturday ${e['saturday']?.['date']}`]:
          (!!e['saturday']?.['value'] &&
            this.formatNumberThreeDecimal(e['saturday']?.['value'])) ||
          null,
        ['H1 00:00 - 01:00']:
          (!!e['h1'] && this.formatNumberThreeDecimal(e['h1'])) || null,
        ['H2 01:01 - 02:00']:
          (!!e['h2'] && this.formatNumberThreeDecimal(e['h2'])) || null,
        ['H3 02:01 - 03:00']:
          (!!e['h3'] && this.formatNumberThreeDecimal(e['h3'])) || null,
        ['H4 03:01 - 04:00']:
          (!!e['h4'] && this.formatNumberThreeDecimal(e['h4'])) || null,
        ['H5 04:01 - 05:00']:
          (!!e['h5'] && this.formatNumberThreeDecimal(e['h5'])) || null,
        ['H6 05:01 - 06:00']:
          (!!e['h6'] && this.formatNumberThreeDecimal(e['h6'])) || null,
        ['H7 06:01 - 07:00']:
          (!!e['h7'] && this.formatNumberThreeDecimal(e['h7'])) || null,
        ['H8 07:01 - 08:00']:
          (!!e['h8'] && this.formatNumberThreeDecimal(e['h8'])) || null,
        ['H9 08:01 - 09:00']:
          (!!e['h9'] && this.formatNumberThreeDecimal(e['h9'])) || null,
        ['H10 09:01 - 10:00']:
          (!!e['h10'] && this.formatNumberThreeDecimal(e['h10'])) || null,
        ['H11 10:01 - 11:00']:
          (!!e['h11'] && this.formatNumberThreeDecimal(e['h11'])) || null,
        ['H12 11:01 - 12:00']:
          (!!e['h12'] && this.formatNumberThreeDecimal(e['h12'])) || null,
        ['H13 12:01 - 13:00']:
          (!!e['h13'] && this.formatNumberThreeDecimal(e['h13'])) || null,
        ['H14 13:01 - 14:00']:
          (!!e['h14'] && this.formatNumberThreeDecimal(e['h14'])) || null,
        ['H15 14:01 - 15:00']:
          (!!e['h15'] && this.formatNumberThreeDecimal(e['h15'])) || null,
        ['H16 15:01 - 16:00']:
          (!!e['h16'] && this.formatNumberThreeDecimal(e['h16'])) || null,
        ['H17 16:01 - 17:00']:
          (!!e['h17'] && this.formatNumberThreeDecimal(e['h17'])) || null,
        ['H18 17:01 - 18:00']:
          (!!e['h18'] && this.formatNumberThreeDecimal(e['h18'])) || null,
        ['H19 18:01 - 19:00']:
          (!!e['h19'] && this.formatNumberThreeDecimal(e['h19'])) || null,
        ['H20 19:01 - 20:00']:
          (!!e['h20'] && this.formatNumberThreeDecimal(e['h20'])) || null,
        ['H21 20:01 - 21:00']:
          (!!e['h21'] && this.formatNumberThreeDecimal(e['h21'])) || null,
        ['H22 21:01 - 22:00']:
          (!!e['h22'] && this.formatNumberThreeDecimal(e['h22'])) || null,
        ['H23 22:01 - 23:00']:
          (!!e['h23'] && this.formatNumberThreeDecimal(e['h23'])) || null,
        ['H24 23:01 - 24:00']:
          (!!e['h24'] && this.formatNumberThreeDecimal(e['h24'])) || null,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          let displayKey = key;
          if (key.includes('day') && gasdayjs && gasdayjs.isValid()) {
            switch (key) {
              case 'Sunday':
                displayKey = gasdayjs.format('DD/MM/YYYY');
                break;
              case 'Monday':
                displayKey = gasdayjs.add(1, 'day').format('DD/MM/YYYY');
                break;
              case 'Tuesday':
                displayKey = gasdayjs.add(2, 'day').format('DD/MM/YYYY');
                break;
              case 'Wednesday':
                displayKey = gasdayjs.add(3, 'day').format('DD/MM/YYYY');
                break;
              case 'Thursday':
                displayKey = gasdayjs.add(4, 'day').format('DD/MM/YYYY');
                break;
              case 'Friday':
                displayKey = gasdayjs.add(5, 'day').format('DD/MM/YYYY');
                break;
              case 'Saturday':
                displayKey = gasdayjs.add(6, 'day').format('DD/MM/YYYY');
              default:
                break;
            }
          }
          obj[displayKey] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    const parseDate = (dateString: string): Date => {
      const [day, month, year] = dateString.split('/');
      return new Date(Number(year), Number(month) - 1, Number(day));
    };

    formateData.sort((a, b) => {
      // ถ้าไม่มี key 'Gas Day' ในออบเจ็กต์ไหน ให้ข้ามไป ไม่ต้องจัดเรียง
      if (!a['Gas Day'] || !b['Gas Day']) {
        return 0;
      }

      const dateA = parseDate(a['Gas Day']);
      const dateB = parseDate(b['Gas Day']);
      return dateB.getTime() - dateA.getTime();
    });

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Quality Planning',
      true,
    );
  }

  async epNominationSummaryNominationReport(response: Response, payload: any) {
    const { key, gas_day_text, filter } = payload || {};

    // dataType['nomination']['daily']['MMSCFD']
    // dataType['nomination']['daily']['MMBTUD']

    // dataType['nomination']['weekly']['MMSCFD']
    // dataType['nomination']['weekly']['MMBTUD']

    // dataType['area']['daily']['MMBTUD']

    // dataType['area']['daily']['Imbalance']

    // dataType['area']['weekly']['MMBTUD']

    // dataType['area']['weekly']['Imbalance']

    // dataType['total']['daily']
    // dataType['total']['weekly']

    const resData = await this.summaryNominationReportService.findAll({
      gas_day_text,
    });
    // const key = "['nomination']['daily']['MMSCFD']"
    let keys = key.match(/(?<=\[')(.*?)(?='\])/g);
    let nomDatas = keys.reduce((obj, key) => obj?.[key], resData);
    let flagDW = false

    if (key === "['total']['daily']" && nomDatas.length === 0) {
      flagDW = true
      keys = "['total']['weekly']".match(/(?<=\[')(.*?)(?='\])/g);
      nomDatas = keys.reduce((obj, key) => obj?.[key], resData);
    } else if (key === "['total']['weekly']" && nomDatas.length === 0) {
      keys = "['total']['daily']".match(/(?<=\[')(.*?)(?='\])/g);
      nomDatas = keys.reduce((obj, key) => obj?.[key], resData);
    }

    // const restype = type === 1 ? resData?.newDaily : type === 2 ? resData?.newWeekly : resData?.intraday
    // "gasday": "01/04/2025"
    // let nrestype = []
    // if(gasday){
    //   nrestype = restype.filter((f:any) => { return f?.gasday === gasday })
    // }else{
    //   nrestype = restype
    // }


    const formateData = await nomDatas.map((e: any) => {
      const nominationDaily = {
        ['Gas Day']: e['gas_day_text'],
        ['Total cap']:
          (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) ||
          null,
        ['Total']:
          (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) ||
          null,
        ['Nomination Point']: e['nomination_point'],
        ['Utilization (%)']: e['utilization'] && this.dcimal2(e['utilization']) || "0.00",
        ['H1']: (!!e['H1'] && this.formatNumberThreeDecimal(e['H1'])) || null,
        ['H2']: (!!e['H2'] && this.formatNumberThreeDecimal(e['H2'])) || null,
        ['H3']: (!!e['H3'] && this.formatNumberThreeDecimal(e['H3'])) || null,
        ['H4']: (!!e['H4'] && this.formatNumberThreeDecimal(e['H4'])) || null,
        ['H5']: (!!e['H5'] && this.formatNumberThreeDecimal(e['H5'])) || null,
        ['H6']: (!!e['H6'] && this.formatNumberThreeDecimal(e['H6'])) || null,
        ['H7']: (!!e['H7'] && this.formatNumberThreeDecimal(e['H7'])) || null,
        ['H8']: (!!e['H8'] && this.formatNumberThreeDecimal(e['H8'])) || null,
        ['H9']: (!!e['H9'] && this.formatNumberThreeDecimal(e['H9'])) || null,
        ['H10']:
          (!!e['H10'] && this.formatNumberThreeDecimal(e['H10'])) || null,
        ['H11']:
          (!!e['H11'] && this.formatNumberThreeDecimal(e['H11'])) || null,
        ['H12']:
          (!!e['H12'] && this.formatNumberThreeDecimal(e['H12'])) || null,
        ['H13']:
          (!!e['H13'] && this.formatNumberThreeDecimal(e['H13'])) || null,
        ['H14']:
          (!!e['H14'] && this.formatNumberThreeDecimal(e['H14'])) || null,
        ['H15']:
          (!!e['H15'] && this.formatNumberThreeDecimal(e['H15'])) || null,
        ['H16']:
          (!!e['H16'] && this.formatNumberThreeDecimal(e['H16'])) || null,
        ['H17']:
          (!!e['H17'] && this.formatNumberThreeDecimal(e['H17'])) || null,
        ['H18']:
          (!!e['H18'] && this.formatNumberThreeDecimal(e['H18'])) || null,
        ['H19']:
          (!!e['H19'] && this.formatNumberThreeDecimal(e['H19'])) || null,
        ['H20']:
          (!!e['H20'] && this.formatNumberThreeDecimal(e['H20'])) || null,
        ['H21']:
          (!!e['H21'] && this.formatNumberThreeDecimal(e['H21'])) || null,
        ['H22']:
          (!!e['H22'] && this.formatNumberThreeDecimal(e['H22'])) || null,
        ['H23']:
          (!!e['H23'] && this.formatNumberThreeDecimal(e['H23'])) || null,
        ['H24']:
          (!!e['H24'] && this.formatNumberThreeDecimal(e['H24'])) || null,
      };

      const nominationWeekly = {
        ['Nomination Point']: e['nomination_point'],
        // ['Sunday']:
        [`Sunday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(0, 'day').format('DD/MM/YYYY')}`]:
          (!!e['sunday'] && this.formatNumberThreeDecimal(e['sunday'])) || null,
        ['Sunday Utilization (%)']: e['sunday_utilization'] && this.dcimal2(e['sunday_utilization']) || null,
        // ['Monday']:
        [`Monday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(1, 'day').format('DD/MM/YYYY')}`]:
          (!!e['monday'] && this.formatNumberThreeDecimal(e['monday'])) || null,
        ['Monday Utilization (%)']: e['monday_utilization'] && this.dcimal2(e['monday_utilization']) || null,
        // ['Tuesday']:
        [`Tuesday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(2, 'day').format('DD/MM/YYYY')}`]:
          (!!e['tuesday'] && this.formatNumberThreeDecimal(e['tuesday'])) ||
          null,
        ['Tuesday Utilization (%)']: e['tuesday_utilization'] && this.dcimal2(e['tuesday_utilization']) || null,
        // ['Wednesday']:
        [`Wednesday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(3, 'day').format('DD/MM/YYYY')}`]:
          (!!e['wednesday'] && this.formatNumberThreeDecimal(e['wednesday'])) ||
          null,
        ['Wednesday Utilization (%)']: e['wednesday_utilization'] && this.dcimal2(e['wednesday_utilization']) || null,
        // ['Thursday']:
        [`Thursday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(4, 'day').format('DD/MM/YYYY')}`]:
          (!!e['thursday'] && this.formatNumberThreeDecimal(e['thursday'])) ||
          null,
        ['Thursday Utilization (%)']: e['thursday_utilization'] && this.dcimal2(e['thursday_utilization']) || null,
        // ['Friday']:
        [`Friday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(5, 'day').format('DD/MM/YYYY')}`]:
          (!!e['friday'] && this.formatNumberThreeDecimal(e['friday'])) || null,
        ['Friday Utilization (%)']: e['friday_utilization'] && this.dcimal2(e['friday_utilization']) || null,
        // ['Saturday']:
        [`Saturday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(6, 'day').format('DD/MM/YYYY')}`]:
          (!!e['saturday'] && this.formatNumberThreeDecimal(e['saturday'])) ||
          null,
        ['Saturday Utilization (%)']: e['saturday_utilization'] && this.dcimal2(e['saturday_utilization']) || null,
      };

      const areaDailyMMBTUD = {
        ['Gas Day']: e['gas_day_text'],
        ['Area']: e['area_text'],
        ['Total cap']:
          (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) ||
          null,
        ['Total']:
          (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) ||
          null,
        ['Nomination Point']: e['nomination_point'],
        ['Utilization (%)']:
          !!e['utilization'] && e['utilization'] !== Infinity
            ? e['utilization'] && this.dcimal2(e['utilization']) || "0.00"
            : '',
        ['H1']: (!!e['H1'] && this.formatNumberThreeDecimal(e['H1'])) || null,
        ['H2']: (!!e['H2'] && this.formatNumberThreeDecimal(e['H2'])) || null,
        ['H3']: (!!e['H3'] && this.formatNumberThreeDecimal(e['H3'])) || null,
        ['H4']: (!!e['H4'] && this.formatNumberThreeDecimal(e['H4'])) || null,
        ['H5']: (!!e['H5'] && this.formatNumberThreeDecimal(e['H5'])) || null,
        ['H6']: (!!e['H6'] && this.formatNumberThreeDecimal(e['H6'])) || null,
        ['H7']: (!!e['H7'] && this.formatNumberThreeDecimal(e['H7'])) || null,
        ['H8']: (!!e['H8'] && this.formatNumberThreeDecimal(e['H8'])) || null,
        ['H9']: (!!e['H9'] && this.formatNumberThreeDecimal(e['H9'])) || null,
        ['H10']:
          (!!e['H10'] && this.formatNumberThreeDecimal(e['H10'])) || null,
        ['H11']:
          (!!e['H11'] && this.formatNumberThreeDecimal(e['H11'])) || null,
        ['H12']:
          (!!e['H12'] && this.formatNumberThreeDecimal(e['H12'])) || null,
        ['H13']:
          (!!e['H13'] && this.formatNumberThreeDecimal(e['H13'])) || null,
        ['H14']:
          (!!e['H14'] && this.formatNumberThreeDecimal(e['H14'])) || null,
        ['H15']:
          (!!e['H15'] && this.formatNumberThreeDecimal(e['H15'])) || null,
        ['H16']:
          (!!e['H16'] && this.formatNumberThreeDecimal(e['H16'])) || null,
        ['H17']:
          (!!e['H17'] && this.formatNumberThreeDecimal(e['H17'])) || null,
        ['H18']:
          (!!e['H18'] && this.formatNumberThreeDecimal(e['H18'])) || null,
        ['H19']:
          (!!e['H19'] && this.formatNumberThreeDecimal(e['H19'])) || null,
        ['H20']:
          (!!e['H20'] && this.formatNumberThreeDecimal(e['H20'])) || null,
        ['H21']:
          (!!e['H21'] && this.formatNumberThreeDecimal(e['H21'])) || null,
        ['H22']:
          (!!e['H22'] && this.formatNumberThreeDecimal(e['H22'])) || null,
        ['H23']:
          (!!e['H23'] && this.formatNumberThreeDecimal(e['H23'])) || null,
        ['H24']:
          (!!e['H24'] && this.formatNumberThreeDecimal(e['H24'])) || null,
      };

      const areaWeeklyMMBTUD = {
        ['Gas Week']: e['gas_day_text'],
        ['Area']: e['area_text'],
        ['Total cap']:
          (Number(e['sunday']) || 0) +
          (Number(e['monday']) || 0) +
          (Number(e['tuesday']) || 0) +
          (Number(e['wednesday']) || 0) +
          (Number(e['thursday']) || 0) +
          (Number(e['friday']) || 0) +
          (Number(e['saturday']) || 0),
        ['Total']:
          (Number(e['sunday']) || 0) +
          (Number(e['monday']) || 0) +
          (Number(e['tuesday']) || 0) +
          (Number(e['wednesday']) || 0) +
          (Number(e['thursday']) || 0) +
          (Number(e['friday']) || 0) +
          (Number(e['saturday']) || 0),
        ['Nomination Point']: e['nomination_point'],
        // ['Sunday']:
        [`Sunday ${dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(0, 'day').format('DD/MM/YYYY')}`]:
          (!!e['sunday'] && this.formatNumberThreeDecimal(e['sunday'])) || null,
        ['Sunday Utilization (%)']: e['sunday_utilization'] && this.dcimal2(e['sunday_utilization']) || "0.00",
        // ['Monday']:
        [`Monday ${dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(1, 'day').format('DD/MM/YYYY')}`]:
          (!!e['monday'] && this.formatNumberThreeDecimal(e['monday'])) || null,
        ['Monday Utilization (%)']: e['monday_utilization'] && this.dcimal2(e['monday_utilization']) || "0.00",
        // ['Tuesday']:
        [`Tuesday ${dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(2, 'day').format('DD/MM/YYYY')}`]:
          (!!e['tuesday'] && this.formatNumberThreeDecimal(e['tuesday'])) ||
          null,
        ['Tuesday Utilization (%)']: e['tuesday_utilization'] && this.dcimal2(e['tuesday_utilization']) || "0.00",
        // ['Wednesday']:
        [`Wednesday ${dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(3, 'day').format('DD/MM/YYYY')}`]:
          (!!e['wednesday'] && this.formatNumberThreeDecimal(e['wednesday'])) ||
          null,
        ['Wednesday Utilization (%)']: e['wednesday_utilization'] && this.dcimal2(e['wednesday_utilization']) || "0.00",
        // ['Thursday']:
        [`Thursday ${dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(4, 'day').format('DD/MM/YYYY')}`]:
          (!!e['thursday'] && this.formatNumberThreeDecimal(e['thursday'])) ||
          null,
        ['Thursday Utilization (%)']: e['thursday_utilization'] && this.dcimal2(e['thursday_utilization']) || "0.00",
        // ['Friday']:
        [`Friday ${dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(5, 'day').format('DD/MM/YYYY')}`]:
          (!!e['friday'] && this.formatNumberThreeDecimal(e['friday'])) || null,
        ['Friday Utilization (%)']: e['friday_utilization'] && this.dcimal2(e['friday_utilization']) || "0.00",
        // ['Saturday']:
        [`Saturday ${dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(6, 'day').format('DD/MM/YYYY')}`]:
          (!!e['saturday'] && this.formatNumberThreeDecimal(e['saturday'])) ||
          null,
        ['Saturday Utilization (%)']: e['saturday_utilization'] && this.dcimal2(e['saturday_utilization']) || "0.00",
      };

      const imbalanceDay = {
        ['Gas Day']: e['gas_day_text'],
        ['Imbalance']:
          (!!e['imbalance'] && this.formatNumberThreeDecimal(e['imbalance'])) ||
          null,
        ['Imbalance (%)']:
          (!!e['imbalance_percent'] &&
            this.formatNumberThreeDecimal(e['imbalance_percent'])) ||
          null,
        ['Park']:
          (!!e['park'] && this.formatNumberThreeDecimal(e['park'])) || null,
        ['Unpark']:
          (!!e['unpark'] && this.formatNumberThreeDecimal(e['unpark'])) || null,
        ['Change Min Invent']:
          (!!e['change_min_invent'] &&
            this.formatNumberThreeDecimal(e['change_min_invent'])) ||
          null,
        ['Shrinkage']:
          (!!e['shrinkage'] && this.formatNumberThreeDecimal(e['shrinkage'])) ||
          null,
      };

      const imbalanceWeek = {
        ['Gas Week']: e['gas_day_text'],
        ['Imbalance']:
          (e['imbalance'] !== null && this.formatNumberThreeDecimal(e['imbalance'])) ||
          null,
        ['Imbalance (%)']:
          (e['imbalance_percent'] !== null &&
            this.formatNumberThreeDecimal(e['imbalance_percent'])) ||
          null,
        ['Park']:
          (e['park'] !== null && this.formatNumberThreeDecimal(e['park'])) || null,
        ['Unpark']:
          (e['unpark'] !== null && this.formatNumberThreeDecimal(e['unpark'])) || null,
        ['Change Min Invent']:
          (e['change_min_invent'] !== null &&
            this.formatNumberThreeDecimal(e['change_min_invent'])) ||
          null,
        ['Shrinkage']:
          (e['shrinkage'] !== null && this.formatNumberThreeDecimal(e['shrinkage'])) ||
          null,
      };

      let totalDW = {}
      if (flagDW) {
        let vl = null
        let util = null
        if (dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(0, 'day').format('DD/MM/YYYY') === gas_day_text) {
          vl = !!e['sunday'] && this.formatNumberThreeDecimal(e['sunday']) || null
          util = e['sunday_utilization'] && this.dcimal2(e['sunday_utilization']) || null
        } else if (dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(1, 'day').format('DD/MM/YYYY') === gas_day_text) {
          vl = !!e['monday'] && this.formatNumberThreeDecimal(e['monday']) || null
          util = e['monday_utilization'] && this.dcimal2(e['monday_utilization']) || null
        } else if (dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(2, 'day').format('DD/MM/YYYY') === gas_day_text) {
          vl = !!e['tuesday'] && this.formatNumberThreeDecimal(e['tuesday']) || null
          util = e['tuesday_utilization'] && this.dcimal2(e['tuesday_utilization']) || null
        } else if (dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(3, 'day').format('DD/MM/YYYY') === gas_day_text) {
          vl = !!e['wednesday'] && this.formatNumberThreeDecimal(e['wednesday']) || null
          util = e['wednesday_utilization'] && this.dcimal2(e['wednesday_utilization']) || null
        } else if (dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(4, 'day').format('DD/MM/YYYY') === gas_day_text) {
          vl = !!e['thursday'] && this.formatNumberThreeDecimal(e['thursday']) || null
          util = e['thursday_utilization'] && this.dcimal2(e['thursday_utilization']) || null
        } else if (dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(5, 'day').format('DD/MM/YYYY') === gas_day_text) {
          vl = !!e['friday'] && this.formatNumberThreeDecimal(e['friday']) || null
          util = e['friday_utilization'] && this.dcimal2(e['friday_utilization']) || null
        } else if (dayjs(e['gas_day_text'], 'DD/MM/YYYY').add(6, 'day').format('DD/MM/YYYY') === gas_day_text) {
          vl = !!e['saturday'] && this.formatNumberThreeDecimal(e['saturday']) || null
          util = e['saturday_utilization'] && this.dcimal2(e['saturday_utilization']) || null
        }

        totalDW = {
          ['Zone']: e['zone_text'],
          ['Entry/Exit']:
            e['entry_exit_id'] === 1
              ? 'Entry'
              : e['entry_exit_id'] === 2
                ? 'Exit'
                : '',
          ['Area']: e['area_text'],
          ['Total cap']: (vl && this.formatNumberThreeDecimal(vl)) || null,
          ['Total']: (vl && this.formatNumberThreeDecimal(vl)) || null,
          ['Nomination Point']: e['nomination_point'],
          ['Park/Unpark-Instructed Flows']: e['ParkUnparkInstructedFlows'],
          ['Customer Type']: e['customerType'],
          ['Units']: e['units'],
          ['Utilization (%)']: util && this.dcimal2(util) || "0.00",
          ['WI']: (e['wi'] && this.formatNumberThreeDecimal(e['wi'])) || null,
          ['HV']: (e['hv'] && this.formatNumberThreeDecimal(e['hv'])) || null,
          ['SG']: (e['sg'] && this.formatNumberThreeDecimal(e['sg'])) || null,
          ['H1']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H2']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H3']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H4']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H5']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H6']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H7']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H8']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H9']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H10']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H11']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H12']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H13']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H14']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H15']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H16']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H17']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H18']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H19']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H20']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H21']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H22']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H23']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
          ['H24']: (!!vl?.replace(/,/g, '')?.trim() && this.formatNumberThreeDecimal(Number(vl?.replace(/,/g, '')?.trim()) / 24)) || null,
        }

      }

      const totalDaily = flagDW ? totalDW : {
        ['Zone']: e['zone_text'],
        ['Entry/Exit']:
          e['entry_exit_id'] === 1
            ? 'Entry'
            : e['entry_exit_id'] === 2
              ? 'Exit'
              : '',
        ['Area']: e['area_text'],
        ['Total cap']: (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) || null,
        ['Total']: (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) || null,
        ['Nomination Point']: e['nomination_point'],
        ['Park/Unpark-Instructed Flows']: e['ParkUnparkInstructedFlows'],
        ['Customer Type']: e['customerType'],
        ['Units']: e['units'],
        ['Utilization (%)']: e['utilization'] && this.dcimal2(e['utilization']) || "0.00",
        ['WI']: (e['wi'] && this.formatNumberThreeDecimal(e['wi'])) || null,
        ['HV']: (e['hv'] && this.formatNumberThreeDecimal(e['hv'])) || null,
        ['SG']: (e['sg'] && this.formatNumberThreeDecimal(e['sg'])) || null,
        ['H1']: (!!e['H1'] && this.formatNumberThreeDecimal(e['H1'])) || null,
        ['H2']: (!!e['H2'] && this.formatNumberThreeDecimal(e['H2'])) || null,
        ['H3']: (!!e['H3'] && this.formatNumberThreeDecimal(e['H3'])) || null,
        ['H4']: (!!e['H4'] && this.formatNumberThreeDecimal(e['H4'])) || null,
        ['H5']: (!!e['H5'] && this.formatNumberThreeDecimal(e['H5'])) || null,
        ['H6']: (!!e['H6'] && this.formatNumberThreeDecimal(e['H6'])) || null,
        ['H7']: (!!e['H7'] && this.formatNumberThreeDecimal(e['H7'])) || null,
        ['H8']: (!!e['H8'] && this.formatNumberThreeDecimal(e['H8'])) || null,
        ['H9']: (!!e['H9'] && this.formatNumberThreeDecimal(e['H9'])) || null,
        ['H10']:
          (!!e['H10'] && this.formatNumberThreeDecimal(e['H10'])) || null,
        ['H11']:
          (!!e['H11'] && this.formatNumberThreeDecimal(e['H11'])) || null,
        ['H12']:
          (!!e['H12'] && this.formatNumberThreeDecimal(e['H12'])) || null,
        ['H13']:
          (!!e['H13'] && this.formatNumberThreeDecimal(e['H13'])) || null,
        ['H14']:
          (!!e['H14'] && this.formatNumberThreeDecimal(e['H14'])) || null,
        ['H15']:
          (!!e['H15'] && this.formatNumberThreeDecimal(e['H15'])) || null,
        ['H16']:
          (!!e['H16'] && this.formatNumberThreeDecimal(e['H16'])) || null,
        ['H17']:
          (!!e['H17'] && this.formatNumberThreeDecimal(e['H17'])) || null,
        ['H18']:
          (!!e['H18'] && this.formatNumberThreeDecimal(e['H18'])) || null,
        ['H19']:
          (!!e['H19'] && this.formatNumberThreeDecimal(e['H19'])) || null,
        ['H20']:
          (!!e['H20'] && this.formatNumberThreeDecimal(e['H20'])) || null,
        ['H21']:
          (!!e['H21'] && this.formatNumberThreeDecimal(e['H21'])) || null,
        ['H22']:
          (!!e['H22'] && this.formatNumberThreeDecimal(e['H22'])) || null,
        ['H23']:
          (!!e['H23'] && this.formatNumberThreeDecimal(e['H23'])) || null,
        ['H24']:
          (!!e['H24'] && this.formatNumberThreeDecimal(e['H24'])) || null,
      };

      const totalWeekly = {
        // gas_day_text
        ['Zone']: e['zone_text'],
        ['Entry/Exit']:
          e['entry_exit_id'] === 1
            ? 'Entry'
            : e['entry_exit_id'] === 2
              ? 'Exit'
              : '',
        ['Area']: e['area_text'],
        // ['Total cap']: e['totalCap'],
        ['Total cap']: (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) || null,
        ['Total']: (e['totalCap'] && this.formatNumberThreeDecimal(e['totalCap'])) || null,
        ['Nomination Point']: e['nomination_point'],
        ['Park/Unpark-Instructed Flows']: e['ParkUnparkInstructedFlows'],
        ['Customer Type']: e['customerType'],
        ['Units']: e['units'],
        ['WI']: (e['wi'] && this.formatNumberThreeDecimal(e['wi'])) || null,
        ['HV']: (e['hv'] && this.formatNumberThreeDecimal(e['hv'])) || null,
        ['SG']: (e['sg'] && this.formatNumberThreeDecimal(e['sg'])) || null,
        [`Sunday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(0, 'day').format('DD/MM/YYYY')}`]:
          (!!e['sunday'] && this.formatNumberThreeDecimal(e['sunday'])) || null,
        ['Sunday Utilization (%)']: e['sunday_utilization'] && this.dcimal2(e['sunday_utilization']) || null,
        [`Monday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(1, 'day').format('DD/MM/YYYY')}`]:
          (!!e['monday'] && this.formatNumberThreeDecimal(e['monday'])) || null,
        ['Monday Utilization (%)']: e['monday_utilization'] && this.dcimal2(e['monday_utilization']) || null,
        [`Tuesday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(2, 'day').format('DD/MM/YYYY')}`]:
          (!!e['tuesday'] && this.formatNumberThreeDecimal(e['tuesday'])) ||
          null,
        ['Tuesday Utilization (%)']: e['tuesday_utilization'] && this.dcimal2(e['tuesday_utilization']) || null,
        [`Wednesday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(3, 'day').format('DD/MM/YYYY')}`]:
          (!!e['wednesday'] && this.formatNumberThreeDecimal(e['wednesday'])) ||
          null,
        ['Wednesday Utilization (%)']: e['wednesday_utilization'] && this.dcimal2(e['wednesday_utilization']) || null,
        [`Thursday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(4, 'day').format('DD/MM/YYYY')}`]:
          (!!e['thursday'] && this.formatNumberThreeDecimal(e['thursday'])) ||
          null,
        ['Thursday Utilization (%)']: e['thursday_utilization'] && this.dcimal2(e['thursday_utilization']) || null,
        [`Friday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(5, 'day').format('DD/MM/YYYY')}`]:
          (!!e['friday'] && this.formatNumberThreeDecimal(e['friday'])) || null,
        ['Friday Utilization (%)']: e['friday_utilization'] && this.dcimal2(e['friday_utilization']) || null,
        [`Saturday ${dayjs((e['gas_day_text'] || gas_day_text), 'DD/MM/YYYY').add(6, 'day').format('DD/MM/YYYY')}`]:
          (!!e['saturday'] && this.formatNumberThreeDecimal(e['saturday'])) ||
          null,
        ['Saturday Utilization (%)']: e['saturday_utilization'] && this.dcimal2(e['saturday_utilization']) || null,
      };
      console.log('e : ', e);
      console.log('totalWeekly : ', totalWeekly);
      // dcimal2
      let setData = null;
      if (
        key === "['nomination']['daily']['MMSCFD']" ||
        key === "['nomination']['daily']['MMBTUD']"
      ) {
        // Total cap
        // Total
        // H1

        setData = nominationDaily;
      } else if (
        key === "['nomination']['weekly']['MMSCFD']" ||
        key === "['nomination']['weekly']['MMBTUD']"
      ) {
        console.log('nominationWeekly : ', nominationWeekly);
        setData = nominationWeekly;
      } else if (key === "['area']['daily']['MMBTUD']") {
        setData = areaDailyMMBTUD;
      } else if (key === "['area']['weekly']['MMBTUD']") {
        setData = areaWeeklyMMBTUD;
      } else if (key === "['area']['daily']['Imbalance']") {
        setData = imbalanceDay;
      } else if (key === "['area']['weekly']['Imbalance']") {
        setData = imbalanceWeek;
      } else if (key === "['total']['daily']") {
        setData = totalDaily || totalWeekly;
      } else if (key === "['total']['weekly']") {
        setData = totalWeekly || totalDaily;
      }

      function addTimetoHourKey(key: string) {
        switch (key) {
          case 'H1':
            return 'H1\n00:00 - 01:00';
          case 'H2':
            return 'H2\n01:00 - 02:00';
          case 'H3':
            return 'H3\n02:00 - 03:00';
          case 'H4':
            return 'H4\n03:00 - 04:00';
          case 'H5':
            return 'H5\n04:00 - 05:00';
          case 'H6':
            return 'H6\n05:00 - 06:00';
          case 'H7':
            return 'H7\n06:00 - 07:00';
          case 'H8':
            return 'H8\n07:00 - 08:00';
          case 'H9':
            return 'H9\n08:00 - 09:00';
          case 'H10':
            return 'H10\n09:00 - 10:00';
          case 'H11':
            return 'H11\n10:00 - 11:00';
          case 'H12':
            return 'H12\n11:00 - 12:00';
          case 'H13':
            return 'H13\n12:00 - 13:00';
          case 'H14':
            return 'H14\n13:00 - 14:00';
          case 'H15':
            return 'H15\n14:00 - 15:00';
          case 'H16':
            return 'H16\n15:00 - 16:00';
          case 'H17':
            return 'H17\n16:00 - 17:00';
          case 'H18':
            return 'H18\n17:00 - 18:00';
          case 'H19':
            return 'H19\n18:00 - 19:00';
          case 'H20':
            return 'H20\n19:00 - 20:00';
          case 'H21':
            return 'H21\n20:00 - 21:00';
          case 'H22':
            return 'H22\n21:00 - 22:00';
          case 'H23':
            return 'H23\n22:00 - 23:00';
          case 'H24':
            return 'H24\n23:00 - 24:00';
          default:
            return key;
        }
      }

      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[addTimetoHourKey(key)] = setData[key]; // เพิ่ม key แ
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Summary Nomination Report',
      true,
      [],
      key.includes('weekly') ? [] : [{ rowIndex: 1, height: 30 }]
    );
  }

  exportDataToExcelNewNomDash(
    data: any[],
    response: Response,
    nameFile: string,
    skipFirstRow: boolean,
  ): void {
    // if (!data || data.length === 0) {
    //   return response
    //     .status(400)
    //     .send({ message: 'Data is empty. Cannot generate Excel file.' });
    // }

    const wb = XLSX.utils.book_new();
    const ws = skipFirstRow
      ? XLSX.utils.aoa_to_sheet([[]])
      : XLSX.utils.aoa_to_sheet([]);

    // ข้อมูลหลักและข้อมูลต่อท้าย
    const mainData = data.slice(0, data.length - 2);
    const tailData = data.slice(data.length - 1); // ข้อมูลจริง
    const tailHeader = Object.keys(tailData[0] || {});
    // const finalData = [...mainData, {}, Object.fromEntries(tailHeader.map(key => [key, key])), ...tailData];
    const finalData = [...mainData];

    // Header หลัก
    const headers = Object.keys(mainData[0] || tailData[0]);
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: skipFirstRow ? 1 : 0 });

    // Add ข้อมูล
    XLSX.utils.sheet_add_json(ws, finalData, {
      origin: skipFirstRow ? 2 : 1,
      skipHeader: true,
    });

    // // แทรก header mixQuality ที่ A หลังจากแถวเว้นว่าง
    // XLSX.utils.sheet_add_aoa(ws, [tailHeader], {
    //   origin: { r: mainData.length + 1 + 1 + (skipFirstRow ? 1 : 0), c: 0 },
    // });

    const rowOffset = mainData.length + 2 + (skipFirstRow ? 1 : 0);

    // ✅ แทรก System (merge cell ถ้าต้องการหลาย column)
    XLSX.utils.sheet_add_aoa(ws, [['System']], {
      origin: { r: rowOffset, c: 0 },
    });

    // ✅ แทรก header ของ tailData ต่อจาก System
    XLSX.utils.sheet_add_aoa(ws, [['Mix Quality', 'Quantity']], {
      origin: { r: rowOffset + 1, c: 0 },
    });


    // ✅ แทรก tailData (อย่ามี header อีก)
    XLSX.utils.sheet_add_json(ws, tailData, {
      origin: { r: rowOffset + 2, c: 0 },
      skipHeader: true,
    });

    // // console.log('tailData : ', tailData);
    // // // แทรกข้อมูลจริงตาม header นั้น
    // XLSX.utils.sheet_add_json(ws, tailData, {
    //   origin: { r: mainData.length + 2 + 1 + (skipFirstRow ? 1 : 0), c: 0 },
    //   skipHeader: true,
    // });

    // ปรับขนาดคอลัมน์
    const objectMaxLength = headers.map((header) => header.length);
    finalData.forEach((row) => {
      Object.keys(row).forEach((key, index) => {
        const columnLength = row[key] ? row[key].toString().length : 0;
        objectMaxLength[index] = Math.max(
          objectMaxLength[index] || 0,
          columnLength,
        );
      });
    });

    ws['!cols'] = objectMaxLength.map((maxLength) => ({
      wch: Math.min(maxLength + 5, 30),
    }));

    // ปรับ wrap text และแถวอัตโนมัติ
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    ws['!rows'] = [];
    for (let R = range.s.r; R <= range.e.r; ++R) {
      let maxHeight = 20;
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[cellAddress];
        if (!cell) continue;

        if (typeof cell.v === 'string') {
          cell.s = {
            alignment: {
              wrapText: true,
              vertical: 'top',
              horizontal: 'left',
            },
          };
          const lines = Math.ceil(cell.v.length / 30);
          maxHeight = Math.max(maxHeight, lines * 15);
        }
      }
      ws['!rows'][R] = { hpx: maxHeight };
    }

    ['A', 'B'].forEach((col, idx) => {
      const ref = XLSX.utils.encode_cell({ r: 1, c: idx });
      ws[ref].s.alignment = { horizontal: 'center', vertical: 'center' };
    });
    ['A'].forEach((col, idx) => {
      const ref = XLSX.utils.encode_cell({ r: rowOffset, c: idx });
      ws[ref].s.alignment = { horizontal: 'center', vertical: 'center' };
    });

    ['A', 'B'].forEach((col, idx) => {
      const ref = XLSX.utils.encode_cell({ r: rowOffset + 1, c: idx });
      ws[ref] = ws[ref] || { t: 's', v: idx === 0 ? 'mixQuality' : 'quality' };
      ws[ref].s = ws[ref].s || {};
      ws[ref].s.alignment = { horizontal: 'center', vertical: 'center' };
    });


    ws['!rows'][0] = { hidden: true };
    XLSX.utils.book_append_sheet(wb, ws, 'DataSheet');

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD_HH-mm')}_${nameFile}.xlsx"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(excelBuffer);
  }

  async epNominationNominationDashboard(response: Response, payload: any) {
    const { gas_day, key, filter } = payload || {};
    // const { key, filter } = payload || {};
    // const gas_day = "2025-09-28"
    //
    const resData = await this.nominationDashboardService.findAll(
      gas_day ? { gas_day } : null,
    );
    const nomDatas =
      key === 1
        ? resData?.data?.daily
        : key === 2
          ? resData?.data?.weekly
          : null;

    const formateData = await nomDatas?.table.map((e: any) => {
      const setData = {
        ['Contract Code']: e['contract_code']?.['contract_code'] || '',
        ['Shipper Name']: e['group']?.['name'] || '',
        ['Entry Quality']: e['entry_quality'] ? '✖' : '✔',
        ['Overuse Quantity']: e['overuse_quantity'] ? '✖' : '✔',
        ['Over Maximum Hour Capacity Right']: e[
          'over_maximum_hour_capacity_right'
        ]
          ? '✖'
          : '✔',
      };
      // ✔
      // ✖

      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    // system
    const system = [
      {},
      {
        ["Mix Quality"]: nomDatas?.system?.mixQuality ? '✖' : '✔',
        ["Quantity"]: nomDatas?.system?.quality ? '✖' : '✔',
      },
    ];
    console.log('formateData : ', formateData);
    console.log('system : ', system);
    const fullDash = [...formateData, ...system];
    console.log('fullDash : ', fullDash);
    await this.exportDataToExcelNewNomDash(
      fullDash,
      response,
      'Nomination Dashboard',
      true,
    );
  }

  async epNominationParkingAllocation(response: Response, payload: any) {
    const { gas_day, filter } = payload || {};
    // ParkingAllocationService

    const resData = await this.parkingAllocationService.findAll({ gas_day });
    // console.log('gas_day : ', gas_day);
    // console.log('resData : ', resData);
    const nResData = resData
      .sort((a, b) => a.zone.localeCompare(b.zone))
      .flatMap((e: any) => {
        const eData = e['data'].map((eD: any) => {
          const { data, ...neD } = eD;
          const parkF = data?.find((f: any) => f?.type === 'Park');
          const park = parkF
            ? this.formatNumberThreeDecimal(parkF?.value)
            : '';
          const unparkF = data?.find((f: any) => f?.type === 'Unpark');
          const unpark = unparkF
            ? this.formatNumberThreeDecimal(unparkF?.value)
            : '';
          const zone = e['zone'];
          const zoneObj = e['zoneObj'];
          const group = eD['data'][0]?.['group']?.['name'];
          const contract_code = data[0]?.['contract_code']?.['contract_code'];
          const parkDefault = e['parkDefault'];
          const lastUserParkValue = e['lastUserParkValue'];
          const version = eD['data'][0]?.['version']?.['version'];
          return {
            ...neD,
            park,
            unpark,
            zone,
            zoneObj,
            group,
            contract_code,
            parkDefault,
            lastUserParkValue,
            version,
            contract_code_text: contract_code,
          };
        });
        //
        console.log('eData : ', eData);
        // parkAllocatedMMBTUD
        const calcTotal = eData?.reduce(
          (accumulator, currentValue) =>
            accumulator + Number(currentValue?.parkAllocatedMMBTUD || 0),
          0,
        );
        const total = [
          {
            zone: `Maximum Park Value : ${(e['parkDefault']?.['value'] && this.formatNumberThreeDecimal(e['parkDefault']?.['value'])) || ''}`,
            group: '',
            contract_code_text: '',
            nomination_code: `EOD Value (D-1)  : ${e?.lastUserParkValue ? this.formatNumberThreeDecimal(e.lastUserParkValue) : ''}`,
            version: '',
            EODPark: 'Available Parking Value',
            unpark: this.formatNumberThreeDecimal(
              eData
                ?.map((p: any) => p?.['unpark'])
                ?.reduce(
                  (accumulator, currentValue) =>
                    accumulator + Number(currentValue?.replace(/,/g, '') || 0),
                  0,
                ) || 0,
            ),
            park: this.formatNumberThreeDecimal(
              eData
                ?.map((p: any) => p?.['park'])
                ?.reduce(
                  (accumulator, currentValue) =>
                    accumulator + Number(currentValue?.replace(/,/g, '') || 0),
                  0,
                ) || 0,
            ),
            parkAllocatedMMBTUD: this.formatNumberThreeDecimal(`${calcTotal}`),
          },
        ];

        return [...eData, ...total];
      });
    // zoneObj
    // console.log('nResData : ', nResData);
    const formateData = await nResData.map((e: any) => {
      const setData = {
        ['Zone']: e['zone'],
        ['Shipper Name']: e['group'] || '',
        ['Contract Code']: e['contract_code_text'] || '',
        ['Nominations Code']: e['nomination_code'],
        ['Version']: e['version'],
        ['EOD Park (MMBTU)']: e['EODPark'],
        ['Unpark Nominations (MMBTU)']: e['unpark'],
        ['Park Nominations (MMBTU)']: e['park'],
        ['Park Allocated (MMBTU)']: e['parkAllocatedMMBTUD'],
      };

      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Parking Allocation',
      true,
    );
  }

  async epMeretingMeteringManagement(response: Response, payload: any) {
    const { share, start_date, end_date, filter } = payload || {};
    const resData = await this.meteringManagementService.getDataLogic(
      {
        share,
        start_date,
        end_date,
      },
      true,
    );
    //
    //
    const formateData = await resData.map((e: any) => {
      const setData = {
        ['Gas Day']: e['gasDay']
          ? dayjs(e['gasDay']).format('DD/MM/YYYY')
          : '',
        ['Metering Point ID']: e['meteringPointId'],
        ['Zone']: e['prop']?.['zone']?.['name'],
        ['Area']: e['prop']?.['area']?.['name'],
        ['Customer Type']: e['prop']?.['customer_type']?.['name'],
        ['Volume (MMSCF)']: this.dcimal6(e['volume']),
        ['Heating Value (BTU/SCF)']: this.dcimal3(e['heatingValue']),
        ['Energy (MMBTU)']: this.dcimal3(e['energy']),
        ['Received Timestamp']:
          (!!e['registerTimestamp'] &&
            dayjs(e['registerTimestamp']).format('DD/MM/YYYY HH:mm:ss')) ||
          null, //"2025-03-10T13:55:45"
        ['TPA Insert Timestamp']: e['insert_timestamp'], //"2025-03-21 16:29:26"
        ['Metering Retrieving ID']: e['metering_retrieving_id'],
        ['Source']: e['datasource'],
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Metering Management',
      true,
    );
  }

  async epMeretingMeteringRetrievingRetrieving(
    response: Response,
    payload: any,
  ) {
    const { bodys, filter } = payload || {};
    // bodys?.limit,bodys?.offset,bodys?.startDate,bodys?.endDate
    const resData =
      await this.meteringManagementService.meteringRetrievingLimit(
        bodys?.limit,
        bodys?.offset,
        bodys?.startDate,
        bodys?.endDate,
        bodys?.metered_run_number_id,
      );
    const find = resData?.data || [];
    const formateData = await find.map((e: any) => {
      const setData = {
        ['Gas Day']: e['data']['gasDay']
          ? dayjs(e['data']['gasDay']).format('DD/MM/YYYY')
          : '',
        ['Metering Retrieving ID']: e['data']['metering_retrieving_id'],
        ['Metering Point ID']: e['data']['meteringPointId'],
        ['Energy (MMBTU)']: e['data']['energy']
          ? this.dcimal3(e['data']['energy'])
          : null,
        ['Timestamp']:
          (!!e['data']['insert_timestamp'] &&
            dayjs(e['data']['insert_timestamp']).format('DD/MM/YYYY HH:mm:ss')) ||
          null,
        ['Error Description']: e['description'],
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Metering Retrieving Retrieving',
      true,
    );
  }

  async epMeretingMeteringRetrievingMeteringDataCheck(
    response: Response,
    payload: any,
  ) {
    const { bodys, filter } = payload || {};
    const resData =
      await this.meteringManagementService.meteringRetrievingMasterCheckLimit(
        bodys?.limit,
        bodys?.offset,
        bodys?.metered_run_number_id,
      );
    const find = resData?.data || [];
    const formateData = await find.map((e: any) => {
      const setData = {
        ['Metering Point ID']: e['data']['meteringPointId'],
        ['Met.Point Description']: e['description'],
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Metering Retrieving Metering Data Check',
      true,
    );
  }

  async epAllocationAllocationReview(response: Response, payload: any) {
    const { bodys, filter } = payload || {};

    const resData = await this.allocationService.allcationOnceId(bodys, null);
    // console.log("resData : ", resData);



    const formateData = await resData?.filter((f: any) => bodys?.idAr?.includes(f?.id))?.map((e: any) => {
      const lengthSubmission =
        (e['allocation_management_comment'].length > 0 &&
          e['allocation_management_comment']
            .map(
              (allocation_management_comment: any) =>
                `${allocation_management_comment?.remark}`,
            )
            .join(',')) ||
        '';

      const setData = {
        ['Status']: e['allocation_status']?.['name'],
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Shipper Name']: e['group']?.['name'],
        ['Contract Code']: e['contract'],
        ['Nomination Point / Concept Point']: e['point'],
        ['Entry / Exit']: e['entry_exit_obj']?.['name'],
        ['Zone']: e?.['zone_obj']?.['name'] || e?.["zone"] || '',
        ['Area']: e?.['area_obj']?.['name'] || e?.["area"] || '',
        ['Nominated Value (MMBTU/D)']: e['nominationValue'],
        ['System Allocation (MMBTU/D)']: e['systemAllocation'] && this.formatNumberFDecimal(e['systemAllocation']),
        ['Previous Allocation TPA for Review (MMBTU/D)']:
          e['previousAllocationTPAforReview'] && this.formatNumberFDecimal(e['previousAllocationTPAforReview']),
        ['Shipper Review Allocation (MMBTU/D)']:
          e['allocation_management_shipper_review']?.length > 0
            ? this.formatNumberFDecimal(e['allocation_management_shipper_review'][0]?.shipper_allocation_review)
            : '',
        ['Review Code']: e['review_code'] || '',
        ['Comment']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Allocation Review',
      true,
    );
  }

  async epAllocationAllocationQuery(response: Response, payload: any) {
    const { bodys, filter } = payload || {};
    // allocationQuery
    const resData = await this.allocationService.allcationOnceIdQuery(
      bodys,
      null,
    );
    // idAr
    // const idArray = bodys?.idAr;
    // const sortedResData = resData.sort(
    //   (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    // );

    // console.log('resData : ', resData);
    // const formateData = await sortedResData.map((e: any) => {
    const formateData = await resData.map((e: any) => {
      const setData = {
        ['Entry / Exit']: e['entry_exit_obj']?.['name'],
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Gas Hour']:
          (e['gas_hour'] &&
            `${e?.gas_hour > 10 ? e?.gas_hour + ':00' : '0' + e?.gas_hour + ':00'}`) ||
          '', //
        ['Shipper Name']: e['group']?.['name'],
        ['Contract Code']: e['contract'],
        ['Nomination Point / Concept Point']: e['point'],
        ['Nominated Value (MMBTU/D)']: e['nominationValue'],
        ['System Allocation (MMBTU/D)']: e['systemAllocation'] && this.dcimal4(e['systemAllocation']) || null,
        ['Timestamp']:
          e['execute_timestamp'] &&
          dayjs(e['execute_timestamp'] * 1000).format('DD/MM/YYYY HH:mm'),
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Allocation Query',
      true,
    );
  }

  insertSignatureEveryNRowsSafe(
    data: any[][],
    interval: number,
    signatureText: string,
    merges: any[],
  ): { data: any[][]; adjustedMerges: (merges: any[]) => any[] } {
    const updatedData = [...data];
    const safeMergeRows = new Set<number>();

    // 👉 เก็บ row ทั้งหมดที่มีการ merge อยู่ใน column B (index 1)
    for (const m of merges) {
      if (m.s.c === 1 && m.e.c === 1) {
        for (let r = m.s.r; r <= m.e.r; r++) {
          safeMergeRows.add(r);
        }
      }
    }

    let offset = 0;

    for (let i = interval; i < updatedData.length + offset; i += interval + 4) {
      let rowToInsert = i + offset;

      // 🔁 ขยับจนกว่าจะไม่เจอ merge ใน column B
      while (safeMergeRows.has(rowToInsert)) {
        rowToInsert++;
      }

      const blankRow = new Array(updatedData[0].length).fill('');
      updatedData.splice(rowToInsert, 0, blankRow, blankRow, blankRow);

      const signatureRow = new Array(updatedData[0].length).fill('');
      signatureRow[signatureRow.length - 1] = signatureText;
      updatedData.splice(rowToInsert + 3, 0, signatureRow);

      offset += 4;
    }

    // 👉 ปรับ merge ทั้งหมดตาม row ที่ถูกแทรก
    const adjustedMerges = (merges: any[]) => {
      return merges.map((m) => {
        const extra = Math.floor(m.s.r / interval) * 4;
        return {
          s: { r: m.s.r + extra, c: m.s.c },
          e: { r: m.e.r + extra, c: m.e.c },
        };
      });
    };

    return { data: updatedData, adjustedMerges };
  }

  async exportDataToExcelNewMontlyTemp(
    dataRes: any,
    response: any,
    nameFile: string,
    userId?: any,
  ) {
    const { headDate, data, typeReport } = dataRes;

    console.log('userId : ', userId);
    const user = await this.prisma.account.findFirst({
      where: {
        id: Number(userId),
      },
      select: {
        first_name: true,
        last_name: true,
        signature: true,
      },
    });
    console.log('user : ', user);
    const licenseSignature = user?.signature || null; // จะเป็น url รูป
    const licenseFullName = user?.first_name + ' ' + user?.last_name;

    // ตรวจสอบว่ามีข้อมูลหรือไม่
    if (!data || data.length === 0) {
      response
        .status(400)
        .send({ message: 'Data is empty. Cannot generate Excel file.' });
    }

    const groupedByContract = data.reduce(
      (acc, item) => {
        const key = item.contract;

        if (!acc[key]) {
          acc[key] = [];
        }

        acc[key] = [...acc[key], ...item.data];
        return acc;
      },
      {} as Record<number, typeof data>,
    );

    const resultDate = headDate;

    // const resultDate = ['2025-02-19', '2025-02-20', '2025-02-21', '2025-02-22', '2025-02-23', '2025-02-24']

    // 👉 สร้าง workbook
    const wb = XLSX.utils.book_new();

    Object.entries(groupedByContract).forEach(([contract, areaGroups]: any) => {
      const sheetData: any[] = [];

      const header0 = [
        'Area',
        'Point',
        'Type',
        ...resultDate.map((d: any, ix) => ix + 1),
      ];
      sheetData.push(header0);
      const header1 = ['Area', 'Point', 'Type', ...resultDate];
      sheetData.push(header1);

      const mergeRanges1: any[] = [];
      // 🟩 Section: summary ราย area
      areaGroups.map((area: any) => {
        const dateMap = Object.fromEntries(
          area?.total.map((r) => [r.date, r.value]),
        );

        const row = [
          area?.area,
          'Total',
          'Total',
          ...resultDate.map((date) => dateMap[date] ?? 0),
        ];

        // ✅ merge B[row], C[row] ถ้าเป็น Total
        const mergeRowIndex = sheetData.length;

        mergeRanges1.push({
          s: { r: mergeRowIndex, c: 2 }, // B[row]
          e: { r: mergeRowIndex, c: 3 }, // C[row]
        });

        sheetData.push(row);
      });

      // 🟨 Section: รายการ contract_point
      const mergeRanges: any[] = [];

      let currentRowIndex = sheetData.length; // เพราะเราจะต่อจาก row ด้านบน

      areaGroups.map((area) => {
        const rowsForThisArea: any[] = [];

        // console.log('area --- : ', area);
        area?.data.forEach((rec) => {
          const row = new Array(3 + resultDate.length).fill('');
          row[0] = area?.area;
          row[1] = rec.point || '';
          row[2] = rec.customer_type || '';

          console.log('rec : ', rec);
          rec.data.map((ed: any) => {
            const dateIndex = resultDate.indexOf(ed?.date);
            if (dateIndex !== -1) {
              row[3 + dateIndex] = ed.value ?? 0;
            }

            return ed;
          });

          // // 👉 แก้ไข: ช่องที่เหลือที่ยังว่าง ('') ให้ใส่ 0
          for (let i = 3; i < row.length; i++) {
            if (row[i] === '') {
              row[i] = 0;
            }
          }

          rowsForThisArea.push(row);
        });

        if (rowsForThisArea.length > 0) {
          // ✅ Merge B[row] ถึง B[row+N-1]
          mergeRanges.push({
            s: { r: currentRowIndex, c: 1 }, // B[row]
            e: { r: currentRowIndex + rowsForThisArea.length - 1, c: 1 }, // B[row+N-1]
          });

          sheetData.push(...rowsForThisArea);
          currentRowIndex += rowsForThisArea.length;
        }
      });

      // 🧾 สร้าง worksheet และใส่ A1 เป็นชื่อกลุ่มเหมือนเดิม
      const ws = XLSX.utils.aoa_to_sheet([]);
      XLSX.utils.sheet_add_aoa(ws, [[contract]], { origin: 'A1' });
      XLSX.utils.sheet_add_aoa(ws, [header0], { origin: 'B1' });
      XLSX.utils.sheet_add_aoa(ws, [header1], { origin: 'B2' });
      // const finalSheetData = this.insertSignatureEveryNRowsSafe(sheetData);
      // const { data: finalSheetData, adjustedMerges } = this.insertSignatureEveryNRowsSafe(
      //   sheetData,
      //   10,
      //   '(.................................)\nนายเขมชาติ ฉิมปลาโท',
      //   [...mergeRanges1, ...mergeRanges]
      // );
      // const adjustedMergeRanges = adjustedMerges([...mergeRanges1, ...mergeRanges]);

      XLSX.utils.sheet_add_json(ws, sheetData.slice(1), {
        // XLSX.utils.sheet_add_json(ws, finalSheetData.slice(1), {
        origin: 'B2',
        skipHeader: true,
      });

      // ws['!headersFooters'] = {
      //   oddFooter: '&L(.................................)\nนายเขมชาติ ฉิมปลาโท', // ขวาล่าง
      // };
      // console.log('wb : ', wb);

      ws['!merges'] = [
        ...(ws['!merges'] || []), // merge เดิมที่ใช้ (ถ้ามี)
        { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }, // Merge B1:B2 (Area)
        { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } }, // Merge C1:C2 (Point)
        { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } }, // Merge D1:D2 (Type)
        // ✅ Merge ที่มาจาก areaGroups
        // ...adjustedMergeRanges,
        ...mergeRanges1,
        ...mergeRanges,
      ];

      // 🟦 ใส่เส้นขอบ + สี header
      const baseCellStyle = {
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
        alignment: {
          vertical: 'top',
          horizontal: 'left',
          wrapText: true,
        },
      };

      const headerStyle = {
        ...baseCellStyle,
        alignment: {
          vertical: 'center', // ชิดกลางแนวตั้ง
          horizontal: 'center', // ชิดกลางแนวนอน
          wrapText: true,
        },
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { rgb: '002060' }, // สีฟ้าเข้ม
        },
        font: {
          color: { rgb: 'FFFFFF' },
          bold: true,
        },
      };

      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[cellRef];
          if (!cell) continue;

          if (R === 0 || R === 1) {
            // แถว header
            cell.s = headerStyle;
          } else {
            // แถวข้อมูลทั่วไป
            // 🔹 เช็คว่าคือ cell ที่มี "Total" และอยู่ในคอลัมน์ C (index 2)

            if (cell.v === 'Total' && C === 2) {
              cell.s = {
                ...baseCellStyle,
                alignment: {
                  vertical: 'center',
                  horizontal: 'center',
                  wrapText: true,
                },
              };
            } else if (C === 1) {
              // 👉 คอลัมน์ B (Area) จัดกลาง
              cell.s = {
                ...baseCellStyle,
                alignment: {
                  vertical: 'center',
                  horizontal: 'center',
                  wrapText: true,
                },
              };
            } else {
              cell.s = baseCellStyle;
            }
          }
        }
      }

      // ✅ เพิ่มแถวว่างก่อนลายเซ็น
      sheetData.push(new Array(header1.length).fill(''));

      // ✅ เพิ่มลายเซ็น
      const signatureRow = new Array(header1.length).fill('');
      const signatureText = licenseSignature
        ? `${licenseFullName}`
        : `( ............................................... )\n${licenseFullName}`;
      signatureRow[1] = signatureText;
      sheetData.push(signatureRow);

      // if (R === range.e.r - 1 && C === 1) {
      //   // ถ้าเป็นเซลล์ลายเซ็น
      //   cell.s = {
      //     ...baseCellStyle,
      //     alignment: {
      //       vertical: 'center',
      //       horizontal: 'center',
      //       wrapText: true,
      //     },
      //     font: {
      //       italic: true,
      //       bold: !licenseSignature, // ถ้าไม่มีลายเซ็นให้เน้น
      //     },
      //   };
      // }

      // 📏 ปรับขนาด column
      const objectMaxLength = header1.map((h) => h.length);
      sheetData.slice(1).forEach((row) => {
        row.forEach((val, idx) => {
          const len = val ? val.toString().length : 0;
          objectMaxLength[idx] = Math.max(objectMaxLength[idx], len);
        });
      });

      ws['A1'].s = {
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { rgb: 'FFFF00' }, // สีเหลือง
        },
        font: {
          bold: true,
        },
        alignment: {
          vertical: 'center',
          horizontal: 'center',
        },
      };

      ws['!cols'] = [
        { wch: 20 },
        ...objectMaxLength.map((maxLength) => ({
          wch: Math.min(maxLength + 5, 30),
        })),
      ];

      XLSX.utils.book_append_sheet(wb, ws, contract.substring(0, 31));
    });

    // เขียนไฟล์ Excel ลงใน Buffer
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    // กำหนดการดาวน์โหลดไฟล์ Excel
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD HH:mm')}_${nameFile}.xlsx"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(excelBuffer);
  }

  // start_date=2025-01-01&end_date=2025-02-28&skip=100&limit=100&tab=1
  // ----

  chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  async exportDataToExcelNewMontly(
    dataRes: any,
    response: any,
    nameFile: string,
    userId?: any,
  ) {
    const { headDate, data, typeReport } = dataRes;

    // const data = [...dataS, ...dataS, ...dataS, ...dataS, ...dataS, ...dataS, ...dataS, ...dataS]
    // console.log('userId : ', userId);
    // userId = userId || 99999;
    // userId = userId || 99999;
    console.log('---');
    const user = userId
      ? await this.prisma.account.findFirst({
        where: { id: Number(userId) },
        select: { first_name: true, last_name: true, signature: true },
      })
      : null;

    console.log('user : ', user);
    console.log('userId : ', userId);
    const sheetRowLimit = 100;
    const licenseSignature = user?.signature || null;
    const licenseFullName = `${user?.first_name || ''} ${user?.last_name || ''}`;

    if (!data || data.length === 0) {
      response
        .status(400)
        .send({ message: 'Data is empty. Cannot generate Excel file.' });
      return;
    }

    const groupedByContract = data.reduce(
      (acc, item) => {
        const key = item.contract;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key] = [...acc[key], ...item.data];
        return acc;
      },
      {} as Record<number, typeof data>,
    );

    const resultDate = headDate;

    const workbook = new ExcelJS.Workbook();
    let imageResponse = null as any;
    if (licenseSignature && typeof licenseSignature === 'string') {
      try {
        assertSafeExternalUrl(licenseSignature);
        imageResponse = await axios.get(licenseSignature, { responseType: 'arraybuffer' });
      } catch (e) {
        imageResponse = null;
      }
    }

    Object.entries(groupedByContract).forEach(([contract, areaGroups]: any) => {
      const sheetData: any[] = [];

      const header0 = [
        'Area',
        'Point',
        'Type',
        ...resultDate.map((_, ix) => ix + 1),
      ];
      const header1 = ['Area', 'Point', 'Type', ...resultDate];
      sheetData.push(header0);
      sheetData.push(header1);

      const mergeRanges1: any[] = [];
      areaGroups.forEach((area: any) => {
        const dateMap = Object.fromEntries(
          area?.total.map((r) => [r.date, r.value]),
        );
        const row = [
          area?.area,
          'Total',
          'Total',
          ...resultDate.map(
            (date) => this.formatNumberFDecimal(dateMap[date]) ?? 0,
          ),
        ];

        const mergeRowIndex = sheetData.length;
        mergeRanges1.push({
          s: { r: mergeRowIndex, c: 2 },
          e: { r: mergeRowIndex, c: 3 },
        });
        sheetData.push(row);
      });

      const mergeRanges: any[] = [];
      let currentRowIndex = sheetData.length;

      areaGroups.forEach((area) => {
        const rowsForThisArea: any[] = [];
        area?.data.forEach((rec) => {
          const row = new Array(3 + resultDate.length).fill('');
          row[0] = area?.area;
          row[1] = rec.point || '';
          row[2] = rec.customer_type || '';

          rec.data.forEach((ed: any) => {
            const dateIndex = resultDate.indexOf(ed?.date);
            if (dateIndex !== -1)
              row[3 + dateIndex] = this.formatNumberFDecimal(ed.value) ?? 0;
          });

          for (let i = 3; i < row.length; i++) {
            if (row[i] === '') row[i] = 0;
          }
          rowsForThisArea.push(row);
        });

        if (rowsForThisArea.length > 0) {
          mergeRanges.push({
            s: { r: currentRowIndex, c: 0 },
            e: { r: currentRowIndex + rowsForThisArea.length - 1, c: 0 },
          });
          sheetData.push(...rowsForThisArea);
          currentRowIndex += rowsForThisArea.length;
        }
      });

      // --------

      const baseCellStyle = {
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
      };

      const headerStyle = {
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF002060' },
        },
        font: { color: { argb: 'FFFFFFFF' }, bold: true },
      };

      const chunkedRows = this.chunkArray(sheetData, sheetRowLimit);
      chunkedRows.forEach((rowsChunk, chunkIndex) => {
        const sheetName =
          chunkIndex === 0
            ? contract.substring(0, 31)
            : `${contract.substring(0, 28)} (${chunkIndex + 1})`;
        const ws = workbook.addWorksheet(sheetName);

        // 🟢 ถ้าไม่ใช่ sheet แรก ให้ลบ header 2 แถวแรกออกก่อน add
        const effectiveRows = chunkIndex === 0 ? rowsChunk : rowsChunk.slice(2);
        effectiveRows.forEach((row) => ws.addRow(['', ...row]));

        ws.getCell('A1').value = contract;
        ws.columns = Array.from(
          { length: effectiveRows[0].length + 1 },
          () => ({ width: 20 }),
        );

        if (chunkIndex === 0) {
          ws.mergeCells('B1:B2');
          ws.mergeCells('C1:C2');
          ws.mergeCells('D1:D2');
          [...mergeRanges1, ...mergeRanges].forEach(({ s, e }) => {
            ws.mergeCells(s.r + 1, s.c + 1, e.r + 1, e.c + 1);
          });
        }

        ws.eachRow((row, rowNumber) => {
          row.eachCell((cell: any, colNumber) => {
            if (
              chunkIndex === 0 &&
              (rowNumber === 1 || rowNumber === 2) &&
              colNumber !== 1
            ) {
              cell.style = headerStyle;
            } else if (colNumber !== 1) {
              if (cell.value === 'Total' && colNumber === 2) {
                cell.style = baseCellStyle;
              } else if (colNumber === 1) {
                cell.style = baseCellStyle;
              } else if (colNumber >= 5) {
                cell.style = {
                  ...baseCellStyle,
                  alignment: {
                    vertical: 'middle',
                    horizontal: 'left',
                    wrapText: true,
                  },
                };
              } else {
                cell.style = baseCellStyle;
              }
            }
          });
        });

        ws.getCell('A1').style = {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFF00' },
          },
          font: { bold: true },
          alignment: { vertical: 'middle', horizontal: 'center' },
        };

        // ✅ วางลายเซ็นทุก sheet
        // const signatureRow = ws.lastRow.number + 3;
        const signatureRow = Math.min(ws.lastRow.number, sheetRowLimit) + 3;
        const colIndex = 1;
        ws.getColumn(1).width = 30;
        ws.getRow(signatureRow).height = 50;
        const signatureCell = ws.getCell(signatureRow, colIndex);
        signatureCell.value = `( .................................................. )`;
        signatureCell.alignment = {
          horizontal: 'center',
          vertical: 'bottom',
          wrapText: true,
        };

        if (licenseSignature) {
          try {
            const imageBuffer = imageResponse.data;
            const imageId = workbook.addImage({
              buffer: imageBuffer,
              extension: 'png',
            });
            ws.addImage(imageId, {
              tl: { col: 0.95, row: signatureRow - 0.5 },
              ext: { width: 90, height: 40 },
            });
            const nameCell = ws.getCell(signatureRow + 2, colIndex);
            nameCell.value = licenseFullName;
            nameCell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            };
          } catch (err) {
            signatureCell.value = `( .................................................. )\n${licenseFullName}`;
          }
        } else {
          signatureCell.value = `( .................................................. )\n${licenseFullName}`;
        }
      });

      // -----

      //   const ws = workbook.addWorksheet(contract.substring(0, 31));
      //   sheetData.forEach((row) => {
      //     ws.addRow(['', ...row]); // ดันไปเริ่มจาก column B
      //   });
      //   ws.getCell('A1').value = contract;
      //   ws.columns = Array.from({ length: sheetData[0].length + 1 }, () => ({ width: 20 }));

      //   ws.mergeCells('B1:B2');
      //   ws.mergeCells('C1:C2');
      //   ws.mergeCells('D1:D2');
      //   [...mergeRanges1, ...mergeRanges].forEach(({ s, e }) => {
      //     ws.mergeCells(s.r + 1, s.c + 1, e.r + 1, e.c + 1);
      //   });

      //   const baseCellStyle = {
      //     border: {
      //       top: { style: 'thin', color: { argb: 'FF000000' } },
      //       left: { style: 'thin', color: { argb: 'FF000000' } },
      //       bottom: { style: 'thin', color: { argb: 'FF000000' } },
      //       right: { style: 'thin', color: { argb: 'FF000000' } },
      //     },
      //     alignment: {
      //       vertical: 'middle',
      //       horizontal: 'center',
      //       wrapText: true,
      //     },
      //   };

      //   const headerStyle = {
      //     // ...baseCellStyle,
      //     alignment: {
      //       vertical: 'middle',
      //       horizontal: 'center',
      //       wrapText: true,
      //     },
      //     fill: {
      //       type: 'pattern',
      //       pattern: 'solid',
      //       fgColor: { argb: 'FF002060' },
      //     },
      //     font: {
      //       color: { argb: 'FFFFFFFF' },
      //       bold: true,
      //     },
      //   };

      //   ws.eachRow((row, rowNumber) => {
      //     row.eachCell((cell: any, colNumber) => {
      //       if ((rowNumber === 1 || rowNumber === 2) && colNumber !== 1) {
      //         cell.style = headerStyle;
      //       } else {
      //         if(colNumber !== 1){
      //           const value = cell.value;
      //           if (value === 'Total' && colNumber === 2) {
      //             cell.style = {
      //               ...baseCellStyle,
      //             };
      //           } else if (colNumber === 1) {
      //             cell.style = {
      //               ...baseCellStyle,
      //             };
      //           } else if (colNumber >= 5) {
      //               cell.style = {
      //                 ...baseCellStyle,
      //                 alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      //               };
      //             }else {
      //             cell.style = baseCellStyle;
      //           }
      //         }
      //       }
      //     });
      //   });

      //   ws.getCell('A1').style = {
      //     fill: {
      //       type: 'pattern',
      //       pattern: 'solid',
      //       fgColor: { argb: 'FFFFFF00' },
      //     },
      //     font: { bold: true },
      //     alignment: { vertical: 'middle', horizontal: 'center' },
      //   };

      // const signatureRow = ws.lastRow.number + 3;
      // const signatureCol = 0;
      // const colIndex = signatureCol + 1;

      // ws.getColumn(1).width = 30; // column A
      // ws.getRow(signatureRow).height = 50; // row สูงพอให้ภาพแสดง

      // // 🟢 วางข้อความลายเซ็น
      // const signatureCell = ws.getCell(signatureRow, colIndex);
      // signatureCell.value = `( .................................................. )`;
      // signatureCell.alignment = {
      //   horizontal: 'center',
      //   vertical: 'bottom',
      //   wrapText: true,
      // };

      // if (licenseSignature) {
      //   try {
      //     const imageBuffer = imageResponse.data;
      //     const imageId = workbook.addImage({ buffer: imageBuffer, extension: 'png' });

      //     const imageWidth = 90;
      //     const imageHeight = 40;

      //     ws.addImage(imageId, {
      //       tl: {
      //         col: 0.95,
      //         row: signatureRow - 0.5,
      //       },
      //       ext: {
      //         width: imageWidth,
      //         height: imageHeight,
      //       },
      //     });

      //     // 🔽 ใส่ชื่อผู้ลงนาม
      //     const nameCell = ws.getCell(signatureRow + 2, colIndex);
      //     nameCell.value = licenseFullName;
      //     nameCell.alignment = {
      //       horizontal: 'center',
      //       vertical: 'middle',
      //       wrapText: true,
      //     };

      //   } catch (err) {
      //     signatureCell.value = `( .................................................. )\n${licenseFullName}`;
      //     signatureCell.alignment = {
      //       horizontal: 'center',
      //       vertical: 'bottom',
      //       wrapText: true,
      //     };
      //   }
      // } else {
      //   signatureCell.value = `( .................................................. )\n${licenseFullName}`;
      //   signatureCell.alignment = {
      //     horizontal: 'center',
      //     vertical: 'bottom',
      //     wrapText: true,
      //   };
      // }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD HH:mm')}_${nameFile}.xlsx"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(buffer);
  }

  // ---

  async epAllocationAllocationMonthlyReport(
    response: Response,
    payload: any,
    userId: any,
  ) {
    console.log('----- : ', userId);

    const resData = await this.allocationService.allocationMonthlyReport(
      payload,
      userId,
    );
    await this.exportDataToExcelNewMontly(
      resData,
      response,
      'Allocation Report',
      null,
    );
  }

  async epAllocationAllocationMonthlyReportDownload(
    response: Response,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    console.log('---- -');
    const resData =
      await this.allocationService.allocationMonthlyReportDownload();
    const idArray = bodys?.idAr;
    //  tab
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Month']: e['monthText'],
        ['Contract Code']: e['contractCode'],
        ['File']: e['file'],
        ['Report Version']: e['version'],
        ['Type Report']: e['typeReport'],
        ['Approved by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Allocation Query',
      true,
    );
  }

  async epAllocationCurtailmentsAllocation(response: Response, payload: any) {
    const { bodys, filter } = payload || {};
    const resData = await this.allocationService.curtailmentsAllocation(
      { type: bodys?.type },
      null,
    );
    const idArray = bodys?.idAr;
    //  tab
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Case ID']: e['case_id'],
        ['Gas Day']: e['gas_day_text'],
        ['Area']: e['area'],
        ['Nomination Point']: e['nomination_point'],
        ['Maximum Capacity']: this.formatNumberFDecimal(e['max_capacity']),
        ['Nomination Value']: this.formatNumberFDecimal(e['nomination_value']),
        ['Unit']: e['unit'],
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Allocation Query',
      true,
    );
  }

  // Balancing
  async epBalancingIntradatAccImbalanceInventoryAdjust(
    response: Response,
    payload: any,
  ) {
    const { id, filter } = payload || {};
    const idArray = id;
    const resData = await this.balancingService.intradayAccImbalanceInventory();
    const fil = resData.filter((f: any) => {
      return idArray.includes(f?.id);
    });
    const sortedResData = fil.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      const lengthSubmission =
        (e['comment'].length > 0 &&
          e['comment'].map((comment: any) => `${comment?.remark}`).join(',')) ||
        '';

      const setData = {
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['East (MMBTU)']:
          (e['east'] && this.formatNumberFDecimal(e['east'])) || '', //
        ['West (MMBTU)']:
          (e['west'] && this.formatNumberFDecimal(e['west'])) || '',
        ['Comment']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission,
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter

      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Intraday Acc Imbalance Inventory Adjust',
      true,
    );
  }

  async epBalancingAdjustmentDailyImbalance(response: Response, payload: any) {
    const { bodys, filter } = payload || {};

    // const idArray = id;
    const resData = await this.balancingService.adjustmentDailyImbalance(
      bodys,
      null,
    );
    // const fil = resData.filter((f:any) => { return idArray.includes(f?.id) })
    // const sortedResData = fil.sort(
    //   (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    // );
    const formateData = await resData.map((e: any) => {
      // const lengthSubmission = (e['comment'].length > 0 &&
      //   e['comment']
      //     .map((comment: any) => `${comment?.remark}`)
      //     .join(',')) ||
      // ""

      const setData = {
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Shipper Name']: e['group']?.['name'] || '', //
        ['Zone']: e['zone_obj']?.['name'] || '', //
        ['Adjust Imbalance']:
          e['adjust_imbalance'] !== null
            ? this.formatNumberFDecimal(e['adjust_imbalance'])
            : '', //
        ['Daily Initial Imbalance']:
          e['dailyAccIm'] !== null
            ? this.formatNumberFDecimal(e['dailyAccIm'])
            : '', //
        ['Daily Final Imbalance']:
          e['finalDailyAccIm'] !== null
            ? this.formatNumberFDecimal(e['finalDailyAccIm'])
            : '', //
        ['Intraday Initial Imbalance']:
          e['intradayAccIm'] !== null
            ? this.formatNumberFDecimal(e['intradayAccIm'])
            : '', //
        ['Intraday Final Imbalance']:
          e['finalIntradayAccIm'] !== null
            ? this.formatNumberFDecimal(e['finalIntradayAccIm'])
            : '', //
        // ['Comment']: lengthSubmission.length > 32767 ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ' : lengthSubmission,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter

      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Intraday Acc Imbalance Inventory Adjust',
      true,
    );
  }

  async epBalancingAdjustAccumulatedImbalance(
    response: Response,
    payload: any,
  ) {
    const { bodys, filter } = payload || {};

    // const idArray = id;
    const resData = await this.balancingService.adjustAccumulatedImbalance(
      bodys,
      null,
    );
    // const fil = resData.filter((f:any) => { return idArray.includes(f?.id) })
    // const sortedResData = fil.sort(
    //   (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    // );
    const formateData = await resData.map((e: any) => {
      // const lengthSubmission = (e['comment'].length > 0 &&
      //   e['comment']
      //     .map((comment: any) => `${comment?.remark}`)
      //     .join(',')) ||
      // ""

      const setData = {
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Shipper Name']: e['group']?.['name'] || '', //
        ['Zone']: e['zone_obj']?.['name'] || '', //
        ['Adjust Imbalance']:
          e['adjust_imbalance'] !== null
            ? this.formatNumberFDecimal(e['adjust_imbalance'])
            : '', //

        ['Daily Acc.Imbalance']: {
          ['Initial Acc. Imbalance']:
            e['dailyAccIm'] !== null
              ? this.formatNumberFDecimal(e['dailyAccIm'])
              : '', //
          ['Final Acc. Imbalance']:
            e['finalDailyAccIm'] !== null
              ? this.formatNumberFDecimal(e['finalDailyAccIm'])
              : '', //
        },
        ['Intraday Acc. Imbalance']: {
          ['Initial Acc. Imbalance']:
            e['intradayAccIm'] !== null
              ? this.formatNumberFDecimal(e['intradayAccIm'])
              : '', //
          ['Final Acc. Imbalance']:
            e['finalIntradayAccIm'] !== null
              ? this.formatNumberFDecimal(e['finalIntradayAccIm'])
              : '', //
        },
        // ['Comment']: lengthSubmission.length > 32767 ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ' : lengthSubmission,
        ['Updated by']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['update_date']
            ? '(' + dayjs(e['update_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        // .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter

      return filteredData;
    });
    // await this.exportDataToExcelNew(
    //   formateData,
    //   response,
    //   'Intraday Acc Imbalance Inventory Adjust',
    //   true,
    // );

    await this.exportDataToExcelWithMultiLevelHeader(
      formateData,
      response,
      'Intraday Acc Imbalance Inventory Adjust',
      true,
    );
  }

  async epBalancingVentCommissioningOtherGas(response: Response, payload: any) {
    const { id, filter } = payload || {};

    const idArray = id;
    const resData = await this.balancingService.ventCommissioningOtherGas();
    const fil = resData.filter((f: any) => {
      return idArray.includes(f?.id);
    });
    const sortedResData = fil.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const lengthSubmission =
        (e['vent_commissioning_other_gas_remark'].length > 0 &&
          e['vent_commissioning_other_gas_remark']
            .map(
              (vent_commissioning_other_gas_remark: any) =>
                `${vent_commissioning_other_gas_remark?.remark}`,
            )
            .join(',')) ||
        '';

      const setData = {
        ['Gas Day']: dayjs(e['gas_day_text'], 'YYYY-MM-DD').format(
          'DD/MM/YYYY',
        ),
        ['Shipper Name']: e['group']?.['name'] || '', //
        ['Zone']: e['zone']?.['name'] || '', // 
        ['Vent Gas (MMBTU)']: e['vent_gas_value_mmbtud'] !== null && this.dcimal4(e['vent_gas_value_mmbtud']) || '', //
        ['Commissioning Gas (MMBTU)']: e['commissioning_gas_value_mmbtud'] !== null && this.dcimal4(e['commissioning_gas_value_mmbtud']) || '', //
        ['Other Gas (MMBTU)']: e['other_gas_value_mmbtud'] !== null && this.dcimal4(e['other_gas_value_mmbtud']) || '', //
        ['Remarks']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission,
        // ['Updated by']: `${
        //   (!!e['update_by_account']?.['first_name'] &&
        //     e['update_by_account']?.['first_name']) ||
        //   ''
        // } ${
        //   (!!e['update_by_account']?.['last_name'] &&
        //     e['update_by_account']?.['last_name']) ||
        //   ''
        // } ${
        //   !!e['update_date']
        //     ? '(' +
        //       dayjs(e['update_date'])
        //         .format('DD/MM/YYYY HH:mm') +
        //       ')'
        //     : ''
        // }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter

      return filteredData;
    });
    await this.exportDataToExcelNew(
      formateData,
      response,
      'Vent Commissioning Other Gas',
      true,
    );
  }

  // {
  //     "gas_day":"2025-05-02", // YYYY-MM-DD ต้องส่ง
  //     "zone":"EAST", // ไม่เลือก ส่ง ว่าง ""
  //     "mode":"E3", // ไม่เลือก ส่ง ว่าง ""
  //     "timestamp":"1739996400", // ไม่เลือก ส่ง ว่าง "" จาก execute_timestamp

  //     "start_date":"2025-05-02",
  //     "end_date":"2025-05-02",
  //     "skip":100,
  //     "limit":100

  // }

  // 🔧 helper: flatten object with path
  flattenObject(
    obj: any,
    prefix = '',
    result: any = {},
    pathArray: string[][] = [],
    currentPath: string[] = [],
  ) {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const newPath = [...currentPath, key];
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        this.flattenObject(
          value,
          prefix ? `${prefix}.${key}` : key,
          result,
          pathArray,
          newPath,
        );
      } else {
        result[prefix ? `${prefix}.${key}` : key] = value;
        pathArray.push(newPath);
      }
    }
    return { result, pathArray };
  }

  // 🔧 helper: build header rows from pathArray

  // buildHeaderRows(paths: string[][]): string[][] {
  //   const maxDepth = Math.max(...paths.map(p => p.length));
  //   const rows: string[][] = Array.from({ length: maxDepth }, () => []);
  //   for (const path of paths) {
  //     for (let i = 0; i < maxDepth; i++) {
  //       rows[i].push(path[i] || '');
  //     }
  //   }
  //   return rows;
  // }
  buildHeaderRows(paths: string[][]): string[][] {
    // console.log('paths : ', paths);
    const maxDepth = Math.max(...paths.map((p) => p.length));
    const rows: string[][] = Array.from({ length: maxDepth }, () => []);

    for (const path of paths) {
      const padded = [...path];
      while (padded.length < maxDepth) padded.push(''); // 🔧 สำคัญมาก
      for (let i = 0; i < maxDepth; i++) {
        rows[i].push(padded[i]);
      }
    }

    return rows;
  }

  // sheet_add_aoa
  exportDataToExcelWithMultiLevelHeader(
    data: any[],
    response: Response,
    nameFile: string,
    skipFirstRow: boolean,
  ): void {
    const wb = XLSX.utils.book_new();
    console.log('data : ', data);
    const flatData = data.map((d) => this.flattenObject(d));
    const allKeys = flatData[0].result;
    const allPaths = flatData[0].pathArray;

    const headers = Object.keys(allKeys);
    const headerRows = this.buildHeaderRows(allPaths);
    const ws = XLSX.utils.aoa_to_sheet([]);

    const rowOffset = 1; // ซ่อนแถวแรกไว้

    // ✅ ใส่ header
    XLSX.utils.sheet_add_aoa(ws, headerRows, { origin: rowOffset });

    // ✅ Add data rows
    const jsonData = flatData.map((f) => f.result);
    const rows = jsonData.map((row) => headers.map((key) => row[key]));
    XLSX.utils.sheet_add_aoa(ws, rows, {
      origin: headerRows.length + rowOffset,
    });

    // ✅ Set number alignment: right
    for (
      let r = headerRows.length + rowOffset;
      r < headerRows.length + rowOffset + rows.length;
      r++
    ) {
      for (let c = 0; c < headers.length; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellAddr];
        if (!cell) continue;

        // if (typeof cell.v === 'number') {
        cell.s = {
          ...cell.s,
          alignment: {
            ...cell.s?.alignment,
            horizontal: 'right',
          },
        };
        // }
      }
    }

    // ✅ Style header rows
    for (let R = 0; R < headerRows.length; R++) {
      for (let C = 0; C < headers.length; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R + rowOffset, c: C });
        if (ws[cellAddress]) {
          ws[cellAddress].s = {
            font: { bold: true },
            alignment: {
              horizontal: 'center',
              vertical: 'center',
              wrapText: true,
            },
            fill: { fgColor: { rgb: 'F4F4F4' } },
            border: {
              top: { style: 'thin', color: { rgb: '999999' } },
              bottom: { style: 'thin', color: { rgb: '999999' } },
              left: { style: 'thin', color: { rgb: '999999' } },
              right: { style: 'thin', color: { rgb: '999999' } },
            },
          };
        }
      }
    }

    // ✅ Merge cells
    const merges: XLSX.Range[] = [];

    // 🔁 Vertical Merge
    // ✅ Merge header cells vertically (สมบูรณ์)
    for (let C = 0; C < headers.length; C++) {
      const colHeader = headerRows.map((row) => row[C]);
      const firstNonEmpty = colHeader.find((v) => v !== '');
      const isStaticColumn = colHeader.every(
        (v) => v === firstNonEmpty || v === '',
      );

      if (isStaticColumn) {
        // 🔁 merge ทั้งแนวตั้ง ถ้าเป็น static header
        merges.push({
          s: { r: rowOffset, c: C },
          e: { r: headerRows.length - 1 + rowOffset, c: C },
        });
      } else {
        // 🔁 merge เฉพาะช่วงที่เหมือนกันแนวตั้ง
        let startR = 0;
        for (let R = 1; R < headerRows.length; R++) {
          if (headerRows[R][C] !== headerRows[startR][C]) {
            if (R - startR > 1) {
              merges.push({
                s: { r: startR + rowOffset, c: C },
                e: { r: R - 1 + rowOffset, c: C },
              });
            }
            startR = R;
          }
        }
        if (headerRows.length - startR > 1) {
          merges.push({
            s: { r: startR + rowOffset, c: C },
            e: { r: headerRows.length - 1 + rowOffset, c: C },
          });
        }
      }
    }

    // 🔁 Horizontal Merge
    for (let R = 0; R < headerRows.length; R++) {
      let startC = 0;
      for (let C = 1; C <= headers.length; C++) {
        if (
          C === headers.length ||
          headerRows[R][C] !== headerRows[R][startC]
        ) {
          if (C - startC > 1 && headerRows[R][startC] !== '') {
            merges.push({
              s: { r: R + rowOffset, c: startC },
              e: { r: R + rowOffset, c: C - 1 },
            });
          }
          startC = C;
        }
      }
    }

    // ✅ Style special rows (TOTAL)
    for (
      let r = headerRows.length + rowOffset;
      r < headerRows.length + rowOffset + rows.length;
      r++
    ) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      const cell1 = ws[XLSX.utils.encode_cell({ r, c: 1 })];
      if (
        cell?.v?.toString().includes('TOTAL :') ||
        cell1?.v?.toString().includes('TOTAL :')
      ) {
        for (let c = 0; c < headers.length; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          if (!ws[cellAddr]) continue;
          ws[cellAddr].s = {
            ...ws[cellAddr].s,
            fill: { fgColor: { rgb: 'E6F8FF' } },
            font: { bold: true },
            alignment: { wrapText: true },
          };
        }
      }
      if (
        cell?.v?.toString().includes('TOTAL ALL :') ||
        cell1?.v?.toString().includes('TOTAL ALL :')
      ) {
        for (let c = 0; c < headers.length; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          if (!ws[cellAddr]) continue;
          ws[cellAddr].s = {
            ...ws[cellAddr].s,
            fill: { fgColor: { rgb: 'FFFACD' } },
            font: { bold: true },
            alignment: { wrapText: true },
          };
        }
      }
    }

    // ✅ Size & Visibility
    const totalRows = headerRows.length + rows.length + rowOffset;
    ws['!rows'] = Array.from({ length: totalRows }, (_, i) => {
      return { hpx: i < headerRows.length + rowOffset ? 40 : 30 };
    });
    ws['!rows'][0] = { hidden: true };

    const colWidths = headers.map((_, colIdx) => {
      const maxLength = Math.max(
        ...[
          ...headerRows.map((r) => r[colIdx]),
          ...rows.map((r) => r[colIdx]?.toString() || ''),
        ].map((v) => v?.length || 0),
      );
      return { wch: Math.min(maxLength + 5, 40) };
    });
    ws['!cols'] = colWidths;
    ws['!merges'] = merges;

    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD_HH-mm')}_${nameFile}.xlsx"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(excelBuffer);
  }

  listToObject(keys: any, valueArr: any, groupMaster: any) {
    const result: any = {};
    keys.forEach((key) => {
      //

      if (key === 'custom_gas_day') {
        result[key] =
          valueArr?.find((f: any) => {
            return f?.tag === key;
          })?.value ?? '';
      } else if (key === 'custom_shipper_name') {
        const shipperIdName =
          valueArr?.find((f: any) => {
            return f?.tag === key;
          })?.value ?? '';

        const findShipperName =
          groupMaster?.find((f: any) => {
            return f?.id_name === shipperIdName;
          })?.name || '';

        result[key] = findShipperName;
      } else if (key === 'custom_contract_code') {
        result[key] =
          valueArr?.find((f: any) => {
            return f?.tag === key;
          })?.value ?? '';
        // } else if (key === 'custom_detail_entry_east_') {
        //   result[key] =
        //     valueArr?.find((f: any) => {
        //       return f?.tag === key;
        //     })?.value ?? '';
        // } else if (key === 'custom_abs_absimb') {
        //   result[key] =
        //     dcimal4(
        //       valueArr?.find((f: any) => {
        //         return f?.tag === "percentage_abslmb";
        //       })?.value,
        //     ) ?? '';
        //     // percentage_abslmb
        //   // result[key] =
        //   //   Math.abs(
        //   //     valueArr?.find((f: any) => {
        //   //       return f?.tag === 'absimb';
        //   //     })?.value,
        //   //   ) ?? '';
        // } else if (key === 'custom_detail_entry_east_') {
        //   result[key] = '';
        // } else if (key === 'custom_detail_entry_west_') {
        //   result[key] = '';
        // } else if (key === 'custom_detail_exit_east_') {
        //   result[key] = '';
        // } else if (key === 'custom_detail_exit_west_') {
        //   result[key] = '';
        // } else if (key === 'custom_detail_exit_east-west_') {
        //   result[key] = '';
      } else {
        result[key] =
          this.formatNumberFDecimal(
            valueArr?.find((f: any) => {
              return f?.tag === key;
            })?.value,
          ) ?? '';
      }
    });
    return result;
  }

  // ...
  async epBalancingBalanceReport(response: Response, payload: any) {
    const { bodys, filter } = payload || {};

    // const idArray = id;
    const resData: any = await this.balancingService.balancReport(bodys, null);
    // const fil = resData.filter((f:any) => { return idArray.includes(f?.id) })
    // const sortedResData = fil.sort(
    //   (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    // );
    // ['Gas Day']: dayjs(e['gas_day'], "YYYY-MM-DD").format("DD/MM/YYYY"),
    // custom_gas_day
    // custom_shipper_name
    // custom_contract_code

    // custom_abs_absimb
    // custom_detail_entry_east_
    // custom_detail_entry_west_
    // custom_detail_exit_east_
    // custom_detail_exit_west_
    // custom_detail_exit_east-west_

    const keyHead = [
      'custom_gas_day', // Gas Day
      'custom_shipper_name', // Shipper Name
      'custom_contract_code', // Contract Code
      'total_entry_east',
      'total_entry_west',
      'total_entry_east-west',
      'total_exit_east',
      'total_exit_west',
      'total_exit_east-west',
      'imbZone_east',
      'imbZone_west',
      'imbZone_total',
      'instructedFlow_east',
      'instructedFlow_west',
      'instructedFlow_east-west',
      'shrinkage_east',
      'shrinkage_west',
      'park_east',
      'park_west',
      'Unpark_east',
      'Unpark_west',
      'SodPark_east',
      'SodPark_west',
      'EodPark_east',
      'EodPark_west',
      'minInventoryChange_east',
      'minInventoryChange_west',
      'reserveBal_east',
      'reserveBal_west',
      'adjustDailyImb_east',
      'adjustDailyImb_west',
      'ventGas_east',
      'ventGas_west',
      'commissioningGas_east',
      'commissioningGas_west',
      'otherGas_east',
      'otherGas_west',
      'dailyImb_east',
      'dailyImb_west',
      'aip',
      'ain',
      'absimb',
      'custom_abs_absimb', //ABS(absimb)
      'accImbMonth_east',
      'accImbMonth_west',
      'accImb_east',
      'accImb_west',
      'percentage_abslmb',
      'minInventory_east',
      'minInventory_west',
      'detail_entry_east_gsp',
      'detail_entry_east_bypassGas',
      'detail_entry_east_lng',
      'custom_detail_entry_east_', //detail_entry_east_ อื่นบวกกัน other
      'detail_entry_west_yadana',
      'detail_entry_west_yetagun',
      'detail_entry_west_zawtika',
      'custom_detail_entry_west_', //detail_entry_west_ อื่นบวกกัน other
      'detail_entry_east-west_ra6East',
      'detail_entry_east-west_ra6West',
      'detail_entry_east-west_bvw10East',
      'detail_entry_east-west_bvw10West',
      'detail_exit_east_egat',
      'detail_exit_east_ipp',
      'custom_detail_exit_east_', //detail_exit_east_ อื่นบวกกัน other
      'detail_exit_west_egat',
      'detail_exit_west_ipp',
      'custom_detail_exit_west_', //detail_exit_west_ อื่นบวกกัน other
      'detail_exit_east-west_egat',
      'detail_exit_east-west_ipp',
      'custom_detail_exit_east-west_', //detail_exit_east-west_ อื่นบวกกัน other
      'detail_exit_east_F2andG',
      'detail_exit_west_F2andG',
      'detail_exit_E_east',
      'detail_exit_E_west',
    ];

    // const dcimal4 = (number: any) => {
    //   if (isNaN(number)) return number;

    //   if (number == 0) {
    //     return '0.0000'; // special case for zero
    //   }

    //   const fixedNumber = parseFloat(number).toFixed(4); // Keep 4 decimal places
    //   const [intPart, decimalPart] = fixedNumber.split('.');

    //   const withCommas = intPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    //   return `${withCommas}.${decimalPart}`;
    // };
    // arr to obj
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
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

    const sumDetail = (values: any[], startWithTag: string, excludedTags: string[]) => {
      if (!values || !Array.isArray(values)) return 0.0000;
      // console.log('values : ', values);
      // console.log('startWithTag : ', startWithTag);
      // console.log('excludedTags : ', excludedTags);
      return this.formatNumberFDecimal(values
        .filter((item: any) => {
          const tag = item?.tag;
          return tag &&
            tag.startsWith(startWithTag) &&
            !excludedTags.includes(tag.replace(startWithTag, ''));
        })
        .reduce((sum: number, item: any) => {
          const value = parseFloat(item?.value) || 0;
          return sum + value;
        }, 0));
    };



    const FMT = 'YYYY-MM-DD';
    const sorted_nrestype = _.orderBy(
      resData?.data,
      [(r) => dayjs(r.gas_day, FMT).valueOf(),],
      ['desc',]
    );

    console.log('sorted_nrestype : ', sorted_nrestype);

    const newData = sorted_nrestype?.flatMap((e: any) => {
      const {
        values: valuesTotalAll,
        shipper_data,
        gas_day,
        request_number,
        execute_timestamp,
        ...nE
      } = e;
      const gasDay = dayjs(e['gas_day'], 'YYYY-MM-DD').format('DD/MM/YYYY');

      const totalShipper = shipper_data?.flatMap((sp: any) => {
        const {
          shipper,
          values: valuesTotalShipper,
          contract_data,
          ...nSp
        } = sp;

        const contractData = contract_data?.map((cd: any) => {
          const { contract, values: valuesContract, ...nCd } = cd;

          const contractObj = this.listToObject(keyHead, [
            ...valuesContract,
            { tag: 'custom_gas_day', value: gasDay || '' },
            { tag: 'custom_shipper_name', value: shipper || '' },
            { tag: 'custom_contract_code', value: contract || '' },
          ], groupMaster);

          return {
            ...contractObj,
            ["values_"]: valuesContract
          };
        });

        const totalShipper = this.listToObject(keyHead, [
          ...valuesTotalShipper,
          { tag: 'custom_gas_day', value: `TOTAL : ${shipper}(${gasDay})` },
          { tag: 'custom_shipper_name', value: '' },
          { tag: 'custom_contract_code', value: '' },
        ], groupMaster);

        const ntotalShipper = { ...totalShipper, ["values_"]: valuesTotalShipper }

        return [...contractData, ntotalShipper];
      });

      const totalAll = this.listToObject(keyHead, [
        ...valuesTotalAll,
        { tag: 'custom_gas_day', value: `TOTAL ALL : (${gasDay})` },
        { tag: 'custom_shipper_name', value: '' },
        { tag: 'custom_contract_code', value: '' },
      ], groupMaster);

      const ntotalAll = { ...totalAll, ["values_"]: valuesTotalAll }

      return [...totalShipper, ntotalAll];
    });
    // console.log('newData : ', newData);
    const formateData = await newData.map((e: any) => {
      const setData = {
        ['Gas Day']: e['custom_gas_day'] || '',
        ['Summary Pane']: {
          ['Shipper Name']: e['custom_shipper_name'] || '',
          ['Contract Code']: e['custom_contract_code'] || '',
          ['Total Entry (MMBTU/D)']: {
            ['East']: e['total_entry_east'],
            ['West']: e['total_entry_west'],
            ['East-West']: e['total_entry_east-west'],
          },
          ['Total Exit (MMBTU/D)']: {
            ['East']: e['total_exit_east'],
            ['West']: e['total_exit_west'],
            ['East-West']: e['total_exit_east-west'],
          },
          ['Imbalance Zone (MMBTU/D)']: {
            ['East']: e['imbZone_east'],
            ['West']: e['imbZone_west'],
            ['Total']: e['imbZone_total'],
          },
          ['Instructed Flow (MMBTU/D)']: {
            ['East']: e['instructedFlow_east'],
            ['West']: e['instructedFlow_west'],
            ['East-West']: e['instructedFlow_east-west'],
          },
          ['Shrinkage Volume (MMBTU/D)']: {
            ['East']: e['shrinkage_east'],
            ['West']: e['shrinkage_west'],
          },
          ['Park (MMBTU/D)']: {
            ['East']: e['park_east'],
            ['West']: e['park_west'],
          },
          ['Unpark (MMBTU/D)']: {
            ['East']: e['Unpark_east'],
            ['West']: e['Unpark_west'],
          },
          ['SOD Park (MMBTU/D)']: {
            ['East']: e['SodPark_east'],
            ['West']: e['SodPark_west'],
          },
          ['EOD Park (MMBTU/D)']: {
            ['East']: e['EodPark_east'],
            ['West']: e['EodPark_west'],
          },
          ['Change Min Inventory (MMBTU/D)']: {
            ['East']: e['minInventoryChange_east'],
            ['West']: e['minInventoryChange_west'],
          },
          ['Reserve Bal. (MMBTU/D)']: {
            ['East']: e['reserveBal_east'],
            ['West']: e['reserveBal_west'],
          },
          ['Adjust Imbalance (MMBTU/D)']: {
            ['East']: e['adjustDailyImb_east'],
            ['West']: e['adjustDailyImb_west'],
          },
          ['Vent Gas']: {
            ['East']: e['ventGas_east'],
            ['West']: e['ventGas_west'],
          },
          ['Commissioning Gas']: {
            ['East']: e['commissioningGas_east'],
            ['West']: e['commissioningGas_west'],
          },
          ['Other Gas']: {
            ['East']: e['otherGas_east'],
            ['West']: e['otherGas_west'],
          },
          ['Daily IMB (MMBTU/D)']: {
            ['East']: e['dailyImb_east'],
            ['West']: e['dailyImb_west'],
          },
          ['AIP (MMBTU/D)']: {
            ['Total']: e['aip'],
          },
          ['AIN (MMBTU/D)']: {
            ['Total']: e['ain'],
          },
          ['%Imb']: {
            ['Total']: e['absimb'],
          },
          ['%Absimb']: {
            // ['Total']: e['custom_abs_absimb'],
            ['Total']: e['absimb'],
          },
          ['Acc. IMB. (MONTH) (MMBTU/D)']: {
            ['East']: e['accImbMonth_east'],
            ['West']: e['accImbMonth_west'],
          },
          ['Acc. IMB. (MMBTU/D)']: {
            ['East']: e['accImb_east'],
            ['West']: e['accImb_west'],
          },
          ['Min. (MMBTU/D)']: {
            ['East']: e['minInventory_east'],
            ['West']: e['minInventory_west'],
          },
        },
        ['Detail Pane']: {
          ['Entry']: {
            ['East']: {
              ['GSP']: e['detail_entry_east_gsp'],
              ['Bypass GSP']: e['detail_entry_east_bypassGas'],
              ['LNG']: e['detail_entry_east_lng'],
              // ['Others']: e['custom_detail_entry_east_'],
              ['Others']: sumDetail(e?.["values_"], 'detail_entry_east_', ['gsp', 'bypassGas', 'lng']),
            },
            ['West']: {
              ['YDN']: e['detail_entry_west_yadana'],
              ['YTG']: e['detail_entry_west_yetagun'],
              ['ZTK']: e['detail_entry_west_zawtika'],
              // ['Others']: e['custom_detail_entry_west_'],
              ['Others']: sumDetail(e?.["values_"], 'detail_entry_west_', ['yadana', 'yetagun', 'zawtika']),

            },
            ['East-West']: {
              ['RA6 East']: e['detail_entry_east-west_ra6East'],
              ['RA6 West']: e['detail_entry_east-west_ra6West'],
              ['BVW10 East']: e['detail_entry_east-west_bvw10East'],
              ['BVW10 West']: e['detail_entry_east-west_bvw10West'],
            },
          },
          ['Exit']: {
            ['East']: {
              ['EGAT']: e['detail_exit_east_egat'],
              ['IPP']: e['detail_exit_east_ipp'],
              // ['Others']: e['custom_detail_exit_east_'],
              ['Others']: sumDetail(e?.["values_"], 'detail_exit_east_', ['egat', 'ipp']),
            },
            ['West']: {
              ['EGAT']: e['detail_exit_west_egat'],
              ['IPP']: e['detail_exit_west_ipp'],
              // ['Others']: e['custom_detail_exit_west_'],
              ['Others']: sumDetail(e?.["values_"], 'detail_exit_west_', ['egat', 'ipp']),
            },
            ['East-West']: {
              ['EGAT']: e['detail_exit_east-west_egat'],
              ['IPP']: e['detail_exit_east-west_ipp'],
              // ['Others']: e['custom_detail_exit_east-west_'],
              ['Others']: sumDetail(e?.["values_"], 'detail_exit_east-west_', ['egat', 'ipp']),
            },
            ['F2&G']: {
              ['East']: e['detail_exit_east_F2andG'],
              ['West']: e['detail_exit_west_F2andG'],
            },
            ['E']: {
              ['East']: e['detail_exit_E_east'],
              ['West']: e['detail_exit_E_west'],
            },
          },
        },
        // ['Low Max (MMBTU)']: !!e['values']?.find((f:any) => { return f?.["tag"] === "low_max" })?.value && this.formatNumberFDecimal(e['values']?.find((f:any) => { return f?.["tag"] === "low_max" })?.value) || '',
      };
      const filteredData = Object.keys(setData)
        // .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter

      return filteredData;
    });


    // await this.exportDataToExcelWithMultiLevelHeader(
    //   formateData,
    //   response,
    //   'Balance Report',
    //   true,
    // );
    // 

    const filterHeader = filter || [];
    //  const filterHeader = [
    //     "Publicate",
    //     "Gas Day",
    //     "Gas Hour",
    //     "Timestamp",
    //     "Summary Pane.Shipper Name",
    //     "Summary Pane.Plan / Actual",
    //     "Summary Pane.Contract Code",
    //     "Summary Pane.Total Entry (MMBTU/D).East",
    //     "Summary Pane.Total Entry (MMBTU/D).West",
    //     "Summary Pane.Total Entry (MMBTU/D).East-West",
    //     "Summary Pane.Total Exit (MMBTU/D).East",
    //     "Summary Pane.Total Exit (MMBTU/D).West",
    //     "Summary Pane.Total Exit (MMBTU/D).East-West",
    //     "Summary Pane.Imbalance Zone (MMBTU/D).East",
    //     "Summary Pane.Imbalance Zone (MMBTU/D).West",
    //     "Summary Pane.Imbalance Zone (MMBTU/D).Total",
    //     "Summary Pane.Instructed Flow (MMBTU/D).East",
    //     "Summary Pane.Instructed Flow (MMBTU/D).West",
    //     "Summary Pane.Instructed Flow (MMBTU/D).East-West",
    //     "Summary Pane.Shrinkage Volume (MMBTU/D).East",
    //     "Summary Pane.Shrinkage Volume (MMBTU/D).West",
    //     "Summary Pane.Park (MMBTU/D).East",
    //     "Summary Pane.Park (MMBTU/D).West",
    //     "Summary Pane.Unpark (MMBTU/D).East",
    //     "Summary Pane.Unpark (MMBTU/D).West",
    //     "Summary Pane.SOD Park (MMBTU/D).East",
    //     "Summary Pane.SOD Park (MMBTU/D).West",
    //     "Summary Pane.EOD Park (MMBTU/D).East",
    //     "Summary Pane.EOD Park (MMBTU/D).West",
    //     "Summary Pane.Change Min Inventory (MMBTU/D).East",
    //     "Summary Pane.Change Min Inventory (MMBTU/D).West",
    //     "Summary Pane.Reserve Bal. (MMBTU/D).East",
    //     "Summary Pane.Reserve Bal. (MMBTU/D).West",
    //     "Summary Pane.Adjust Imbalance (MMBTU/D).East",
    //     "Summary Pane.Adjust Imbalance (MMBTU/D).West",
    //     "Summary Pane.Vent Gas.East",
    //     "Summary Pane.Vent Gas.West",
    //     "Summary Pane.Commissioning Gas.East",
    //     "Summary Pane.Commissioning Gas.West",
    //     "Summary Pane.Other Gas.East",
    //     "Summary Pane.Other Gas.West",
    //     "Summary Pane.Daily IMB (MMBTU/D).East",
    //     "Summary Pane.Daily IMB (MMBTU/D).West",
    //     "Summary Pane.AIP (MMBTU/D).Total",
    //     "Summary Pane.AIN (MMBTU/D).Total",
    //     "Summary Pane.%Imb.Total",
    //     "Summary Pane.%Absimb.Total",
    //     "Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).East",
    //     "Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).West",
    //     "Summary Pane.Acc. IMB. (MMBTU/D).East",
    //     "Summary Pane.Acc. IMB. (MMBTU/D).West",
    //     "Summary Pane.Min. (MMBTU/D).East",
    //     "Summary Pane.Min. (MMBTU/D).West",
    //     "Detail Pane.Entry.East.GSP",
    //     "Detail Pane.Entry.East.Bypass GSP",
    //     "Detail Pane.Entry.East.LNG",
    //     "Detail Pane.Entry.East.Others",
    //     "Detail Pane.Entry.West.YDN",
    //     "Detail Pane.Entry.West.YTG",
    //     "Detail Pane.Entry.West.ZTK",
    //     "Detail Pane.Entry.West.Others",
    //     "Detail Pane.Entry.East-West.RA6 East",
    //     "Detail Pane.Entry.East-West.RA6 West",
    //     "Detail Pane.Entry.East-West.BVW10 East",
    //     "Detail Pane.Entry.East-West.BVW10 West",
    //     "Detail Pane.Exit.East.EGAT",
    //     "Detail Pane.Exit.East.IPP",
    //     "Detail Pane.Exit.East.Others",
    //     "Detail Pane.Exit.West.EGAT",
    //     "Detail Pane.Exit.West.IPP",
    //     "Detail Pane.Exit.West.Others",
    //     "Detail Pane.Exit.East-West.EGAT",
    //     "Detail Pane.Exit.East-West.IPP",
    //     "Detail Pane.Exit.East-West.Others",
    //     "Detail Pane.Exit.F2&G.East",
    //     "Detail Pane.Exit.F2&G.West",
    //     "Detail Pane.Exit.E.East",
    //     "Detail Pane.Exit.E.West"
    // ]

    // header color
    const headerColorMap = {
      // 'Gas Day': '1573A1', // #1573A1
      // 'Gas Hour': '1573A1', // #1573A1
      // Timestamp: '1573A1', // #1573A1
      // Zone: '1573A1', // #1573A1
      // Mode: '1573A1', // #1573A1
      // 'Shipper Name': '1573A1', // #1573A1
      // 'HV (BTU/SCF)': '1573A1', // #1573A1
      // 'Base Inventory Value (MMBTU)': '1573A1', // #1573A1
      // 'High Max (MMBTU)': '606060', // #606060
      // 'High Difficult Day (MMBTU)': 'A656C4', // #A656C4
      // 'High Red (MMBTU)': 'E94A4C', // #E94A4C
      // 'High Orange (MMBTU)': 'F0843A', // #F0843A
      // 'Alert High (MMBTU)': 'EAC12A', // #EAC12A
      // 'Alert Low (MMBTU)': 'EAC12A', // #EAC12A
      // 'Low Orange (MMBTU)': 'F0843A', // #F0843A
      // 'Low Red (MMBTU)': 'E94A4C', // #E94A4C
      // 'Low Difficult Day (MMBTU)': 'A656C4', // #A656C4
      // 'Low Max (MMBTU)': '606060', // #606060
      "Publicate": '1573A1', // #1573A1
      "Gas Day": '1573A1', // #1573A1
      "Gas Hour": '1573A1', // #1573A1
      "Timestamp": '1573A1', // #1573A1
      "Summary Pane": 'DEA477', // #DEA477
      "Summary Pane.Shipper Name": '1573A1', // #1573A1
      "Summary Pane.Plan / Actual": '1573A1', // #1573A1
      "Summary Pane.Contract Code": '1573A1', // #1573A1
      "Summary Pane.Total Entry (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Total Entry (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Total Entry (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Total Entry (MMBTU/D).East-West": 'A6F5BF', // #A6F5BF
      "Summary Pane.Total Exit (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Total Exit (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Total Exit (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Total Exit (MMBTU/D).East-West": 'A6F5BF', // #A6F5BF
      "Summary Pane.Imbalance Zone (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Imbalance Zone (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Imbalance Zone (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Imbalance Zone (MMBTU/D).Total": 'F2F2F2', // #F2F2F2
      "Summary Pane.Instructed Flow (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Instructed Flow (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Instructed Flow (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Instructed Flow (MMBTU/D).East-West": 'A6F5BF', // #A6F5BF
      "Summary Pane.Shrinkage Volume (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Shrinkage Volume (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Shrinkage Volume (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Park (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Park (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Park (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Unpark (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Unpark (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Unpark (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.SOD Park (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.SOD Park (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.SOD Park (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.EOD Park (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.EOD Park (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.EOD Park (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Change Min Inventory (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Change Min Inventory (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Change Min Inventory (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Reserve Bal. (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Reserve Bal. (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Reserve Bal. (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Adjust Imbalance (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Adjust Imbalance (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Adjust Imbalance (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Vent Gas": '1573A1', // #1573A1
      "Summary Pane.Vent Gas.East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Vent Gas.West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Commissioning Gas": '1573A1', // #1573A1
      "Summary Pane.Commissioning Gas.East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Commissioning Gas.West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Other Gas": '1573A1', // #1573A1
      "Summary Pane.Other Gas.East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Other Gas.West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Daily IMB (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Daily IMB (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Daily IMB (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.AIP (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.AIP (MMBTU/D).Total": 'F2F2F2', // #F2F2F2
      "Summary Pane.AIN (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.AIN (MMBTU/D).Total": 'F2F2F2', // #F2F2F2
      "Summary Pane.%Imb": '1573A1', // #1573A1
      "Summary Pane.%Imb.Total": 'F2F2F2', // #F2F2F2
      "Summary Pane.%Absimb": '1573A1', // #1573A1
      "Summary Pane.%Absimb.Total": 'F2F2F2', // #F2F2F2
      "Summary Pane.Acc. IMB. (MONTH) (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Acc. IMB. (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Acc. IMB. (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Acc. IMB. (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Summary Pane.Min. (MMBTU/D)": '1573A1', // #1573A1
      "Summary Pane.Min. (MMBTU/D).East": 'DBE4FF', // #DBE4FF
      "Summary Pane.Min. (MMBTU/D).West": 'FCB3CE', // #FCB3CE
      "Detail Pane": '6EA48D', // #6EA48D
      "Detail Pane.Entry": '1573A1', // #1573A1
      "Detail Pane.Entry.East": 'DBE4FF', // #DBE4FF
      "Detail Pane.Entry.East.GSP": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.East.Bypass GSP": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.East.LNG": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.East.Others": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.West": 'FCB3CE', // #FCB3CE
      "Detail Pane.Entry.West.YDN": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.West.YTG": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.West.ZTK": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.West.Others": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.East-West": 'A6F5BF', // #A6F5BF
      "Detail Pane.Entry.East-West.RA6 East": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.East-West.RA6 West": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.East-West.BVW10 East": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Entry.East-West.BVW10 West": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit": '1573A1', // #1573A1
      "Detail Pane.Exit.East": 'DBE4FF', // #DBE4FF
      "Detail Pane.Exit.East.EGAT": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.East.IPP": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.East.Others": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.West": 'FCB3CE', // #FCB3CE
      "Detail Pane.Exit.West.EGAT": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.West.IPP": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.West.Others": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.East-West": 'A6F5BF', // #A6F5BF
      "Detail Pane.Exit.East-West.EGAT": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.East-West.IPP": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.East-West.Others": 'E0E0E0', // ##E0E0E0
      "Detail Pane.Exit.F2&G": '1573A1', // #1573A1
      "Detail Pane.Exit.F2&G.East": 'E5EED9', // ##E5EED9
      "Detail Pane.Exit.F2&G.West": 'DBE1F2', // ##DBE1F2
      "Detail Pane.Exit.E": '1573A1', // #1573A1
      "Detail Pane.Exit.E.East": 'E5EED9', // ##E5EED9
      "Detail Pane.Exit.E.West": 'DBE1F2', // ##DBE1F2
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          // Gas Day
          // if(key === "Gas Day"){
          //   console.log('result[key] : ', data[i]["Gas Day"]);
          //   result[key][i] = 'C9C9C9'; //#C9C9C9
          // }
          // console.log('data[i]["Gas Day"] : ', data[i]["Gas Day"]);
          // TOTAL ALL :
          // TOTAL :
          if (data[i]["Gas Day"].includes('TOTAL :')) {
            result[key][i] = 'E6F8FF'; //#E6F8FF
          }
          if (data[i]["Gas Day"].includes('TOTAL ALL :')) {
            result[key][i] = 'FEFBEC'; //#FEFBEC
          }

        }
        // for (let i = 0; i < data.length; i++) {
        //   if (key === 'High Max (MMBTU)') {
        //     result[key][i] = 'C9C9C9'; //#C9C9C9
        //   }
        //   if (key === 'High Difficult Day') {
        //     result[key][i] = 'f6f0f9'; //#f6f0f9
        //   }
        //   if (key === 'High Red (MMBTU)') {
        //     result[key][i] = 'fceeed'; //#fceeed
        //   }
        //   if (key === 'High Orange (MMBTU)') {
        //     result[key][i] = 'fcf3ed'; //#fcf3ed
        //   }
        //   if (key === 'Alert High (MMBTU)') {
        //     result[key][i] = 'fef9ee'; //#fef9ee
        //   }
        //   if (key === 'Alert Low (MMBTU)') {
        //     result[key][i] = 'fef9ee'; //#fef9ee
        //   }
        //   if (key === 'Low Orange (MMBTU)') {
        //     result[key][i] = 'fcf3ed'; //#fcf3ed
        //   }
        //   if (key === 'Low Red (MMBTU)') {
        //     result[key][i] = 'fceeed'; //#fceeed
        //   }
        //   if (key === 'Low Difficult Day') {
        //     result[key][i] = 'f6f0f9'; //#f6f0f9
        //   }
        //   if (key === 'Low Max (MMBTU)') {
        //     result[key][i] = 'C9C9C9'; //#C9C9C9
        //   }
        // }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Balance Report',
      true,
      headerColorMap,
      cellHighlightMap,
    );


    // 
  }

  async epBalancingIntradayAccImbalanceInventoryOriginal(
    response: Response,
    payload: any,
  ) {
    const { bodys, filter } = payload || {};

    const resData: any =
      await this.balancingService.intradayAccImbalanceInventoryOriginal(
        bodys,
        null,
      );

    console.log('**resData : ', resData);

    const dcimal4 = (number: any) => {
      if (isNaN(number)) return number;

      if (number == 0) {
        return '0.0000'; // special case for zero
      }

      const fixedNumber = parseFloat(number).toFixed(4); // Keep 4 decimal places
      const [intPart, decimalPart] = fixedNumber.split('.');

      const withCommas = intPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      return `${withCommas}.${decimalPart}`;
    };

    // console.log('newData : ', newData);
    const formateData = await resData.map((e: any) => {
      const setData = {
        ['Timestamp']: e['timestamp'],
        ['Gas Hour']: e['gasHour'],
        ['Publicate']: e['publication'] && "Public",
        ['Acc. Total Inventory (MMBTU)']: {
          ['East']: (dcimal4(e['east_totalInv'])),
          ['West']: (dcimal4(e['west_totalInv'])),
        },
        ['Base Inventory (MMBTU)']: {
          ['East']: (dcimal4(e['east_baseInv'])),
          ['West']: (dcimal4(e['west_baseInv'])),
        },
        ['Total Acc. IMB. (Inventory) (MMBTU)']: {
          ['East']:
            (dcimal4(e['east_totalAccImbInv'])),
          ['West']:
            (dcimal4(e['west_totalAccImbInv'])),
        },
        ['Acc. IMB. Exclude PTT Shipper (MMBTU)']: {
          ['East']:
            (
              dcimal4(e['east_accImbExculdePTT'])),
          ['West']:
            (
              dcimal4(e['west_accImbExculdePTT'])),
        },
        ['Others (MMBTU)']: {
          ['East']: (dcimal4(e['east_other'])),
          ['West']: (dcimal4(e['west_other'])),
        },
        ['Acc. IMB. Inventory for PTT Shipper (MMBTU)']: {
          ['East']:
            (dcimal4(e['east_accImbInvPTT'])),
          ['West']:
            (dcimal4(e['west_accImbInvPTT'])),
        },
        ['Mode/Zone']: {
          ['East']: e['east_mode_zone'],
          ['West']: e['west_mode_zone'],
        },
      };
      const filteredData = Object.keys(setData)
        // .filter((key) => filter.includes(key))
        .reduce((obj, key) => {
          obj[key] = setData[key];
          return obj;
        }, {});

      return filteredData;
    });
    await this.exportDataToExcelWithMultiLevelHeader(
      formateData,
      response,
      'Intraday Acc. Imbalance Inventory',
      true,
    );
  }

  async balanceIntradayDashboardOld(
    response: Response,
    payload: any,
    userId: any,
  ) {
    // const userId = 99999
    const { bodys, filter } = payload || {};
    const resData: any = await this.balancingService.balanceIntradayDashboard(
      bodys,
      userId,
    );
    const dcimal4 = (number: any) => {
      if (isNaN(number)) return number;

      if (number == 0) {
        return '0.0000'; // special case for zero
      }

      const fixedNumber = parseFloat(number).toFixed(4); // Keep 4 decimal places
      const [intPart, decimalPart] = fixedNumber.split('.');

      const withCommas = intPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      return `${withCommas}.${decimalPart}`;
    };

    const nresData = resData?.flatMap((e: any) => {
      const { plan_, actual_, ...nE } = e;
      const actual = [];
      const plan = [];

      plan?.push({
        ['time']: e['gas_hour'] || '', //
        ['plan/actual']: 'Plan',
        ['total_entry_east']:
          plan_?.['total_entry_east']?.['value'] &&
          dcimal4(plan_?.['total_entry_east']?.['value'] ?? 0),
        ['total_entry_west']:
          plan_?.['total_entry_west']?.['value'] &&
          dcimal4(plan_?.['total_entry_west']?.['value'] ?? 0),
        ['total_entry_east-west']:
          plan_?.['total_entry_east-west']?.['value'] &&
          dcimal4(plan_?.['total_entry_east-west']?.['value'] ?? 0),
        ['total_exit_east']:
          plan_?.['total_exit_east']?.['value'] &&
          dcimal4(plan_?.['total_exit_east']?.['value'] ?? 0),
        ['total_exit_west']:
          plan_?.['total_exit_west']?.['value'] &&
          dcimal4(plan_?.['total_exit_west']?.['value'] ?? 0),
        ['total_exit_east-west']:
          plan_?.['total_exit_east-west']?.['value'] &&
          dcimal4(plan_?.['total_exit_east-west']?.['value'] ?? 0),
        ['revserveBal_east']:
          plan_?.['revserveBal_east']?.['value'] &&
          dcimal4(plan_?.['revserveBal_east']?.['value'] ?? 0),
        ['revserveBal_west']:
          plan_?.['revserveBal_west']?.['value'] &&
          dcimal4(plan_?.['revserveBal_west']?.['value'] ?? 0),
        ['revserveBal_east-west']:
          plan_?.['revserveBal_east-west']?.['value'] &&
          dcimal4(plan_?.['revserveBal_east-west']?.['value'] ?? 0),
        ['park/unpark_east']:
          plan_?.['park/unpark_east'] && dcimal4(plan_?.['park/unpark_east']),
        ['park/unpark_west']:
          plan_?.['park/unpark_west'] && dcimal4(plan_?.['park/unpark_west']),
        ['detail_entry_east-west_ra6Ratio']:
          plan_?.['detail_entry_east-west_ra6Ratio']?.['value'] &&
          dcimal4(plan_?.['detail_entry_east-west_ra6Ratio']?.['value'] ?? 0),
        ['detail_entry_east-west_bvw10Ratio']:
          plan_?.['detail_entry_east-west_bvw10Ratio']?.['value'] &&
          dcimal4(plan_?.['detail_entry_east-west_bvw10Ratio']?.['value'] ?? 0),
        ['shrinkage_others_east']:
          plan_?.['shrinkage_others_east']?.['value'] &&
          dcimal4(plan_?.['shrinkage_others_east']?.['value'] ?? 0),
        ['shrinkage_others_west']:
          plan_?.['shrinkage_others_west']?.['value'] &&
          dcimal4(plan_?.['shrinkage_others_west']?.['value'] ?? 0),
        ['shrinkage_others_east-west']:
          plan_?.['shrinkage_others_east-west']?.['value'] &&
          dcimal4(plan_?.['shrinkage_others_east-west']?.['value'] ?? 0),
        ['minInventoryChange_east']:
          plan_?.['minInventoryChange_east']?.['value'] &&
          dcimal4(plan_?.['minInventoryChange_east']?.['value'] ?? 0),
        ['minInventoryChange_west']:
          plan_?.['minInventoryChange_west']?.['value'] &&
          dcimal4(plan_?.['minInventoryChange_west']?.['value'] ?? 0),
        ['minInventoryChange_east-west']:
          plan_?.['minInventoryChange_east-west']?.['value'] &&
          dcimal4(plan_?.['minInventoryChange_east-west']?.['value'] ?? 0),
        ['dailyImb_east']:
          plan_?.['dailyImb_east']?.['value'] &&
          dcimal4(plan_?.['dailyImb_east']?.['value'] ?? 0),
        ['dailyImb_west']:
          plan_?.['dailyImb_west']?.['value'] &&
          dcimal4(plan_?.['dailyImb_west']?.['value'] ?? 0),
        ['accImb_east']:
          plan_?.['accImb_east']?.['value'] &&
          dcimal4(plan_?.['accImb_east']?.['value'] ?? 0),
        ['accImb_west']:
          plan_?.['accImb_west']?.['value'] &&
          dcimal4(plan_?.['accImb_west']?.['value'] ?? 0),
        ['accImbInv_east']:
          plan_?.['accImbInv_east']?.['value'] &&
          dcimal4(plan_?.['accImbInv_east']?.['value'] ?? 0),
        ['accImbInv_west']:
          plan_?.['accImbInv_west']?.['value'] &&
          dcimal4(plan_?.['accImbInv_west']?.['value'] ?? 0),
        ['dailyImb_total']:
          plan_?.['dailyImb_total']?.['value'] &&
          dcimal4(plan_?.['dailyImb_total']?.['value'] ?? 0),
        ['absimb']:
          plan_?.['absimb']?.['value'] &&
          dcimal4(plan_?.['absimb']?.['value'] ?? 0),
        ['system_level_east']: plan_?.['system_level_east'] ?? 0,
        ['level_percentage_east']:
          plan_?.['level_percentage_east']?.['value'] &&
          dcimal4(plan_?.['level_percentage_east']?.['value'] ?? 0),
        ['energyAdjustIFOFO_east']:
          plan_?.['energyAdjustIFOFO_east']?.['value'] &&
          dcimal4(plan_?.['energyAdjustIFOFO_east']?.['value'] ?? 0),
        ['volumeAdjustIFOFO_east']:
          plan_?.['volumeAdjustIFOFO_east']?.['value'] &&
          dcimal4(plan_?.['volumeAdjustIFOFO_east']?.['value'] ?? 0),
        ['system_level_west']: plan_?.['system_level_west'] ?? 0,
        ['level_percentage_west']:
          plan_?.['level_percentage_west']?.['value'] &&
          dcimal4(plan_?.['level_percentage_west']?.['value'] ?? 0),
        ['energyAdjustIFOFO_west']:
          plan_?.['energyAdjustIFOFO_west']?.['value'] &&
          dcimal4(plan_?.['energyAdjustIFOFO_west']?.['value'] ?? 0),
        ['volumeAdjustIFOFO_west']:
          plan_?.['volumeAdjustIFOFO_west']?.['value'] &&
          dcimal4(plan_?.['volumeAdjustIFOFO_west']?.['value'] ?? 0),
        ['condition_east']: plan_?.['condition_east']?.['value'],
        ['condition_west']: plan_?.['condition_west']?.['value'],
      });

      actual?.push({
        ['time']: e['gas_hour'] || '', //
        ['plan/actual']: 'Actual',
        ['total_entry_east']:
          actual_?.['total_entry_east']?.['value'] &&
          dcimal4(actual_?.['total_entry_east']?.['value'] ?? 0),
        ['total_entry_west']:
          actual_?.['total_entry_west']?.['value'] &&
          dcimal4(actual_?.['total_entry_west']?.['value'] ?? 0),
        ['total_entry_east-west']:
          actual_?.['total_entry_east-west']?.['value'] &&
          dcimal4(actual_?.['total_entry_east-west']?.['value'] ?? 0),
        ['total_exit_east']:
          actual_?.['total_exit_east']?.['value'] &&
          dcimal4(actual_?.['total_exit_east']?.['value'] ?? 0),
        ['total_exit_west']:
          actual_?.['total_exit_west']?.['value'] &&
          dcimal4(actual_?.['total_exit_west']?.['value'] ?? 0),
        ['total_exit_east-west']:
          actual_?.['total_exit_east-west']?.['value'] &&
          dcimal4(actual_?.['total_exit_east-west']?.['value'] ?? 0),
        ['revserveBal_east']:
          actual_?.['revserveBal_east']?.['value'] &&
          dcimal4(actual_?.['revserveBal_east']?.['value'] ?? 0),
        ['revserveBal_west']:
          actual_?.['revserveBal_west']?.['value'] &&
          dcimal4(actual_?.['revserveBal_west']?.['value'] ?? 0),
        ['revserveBal_east-west']:
          actual_?.['revserveBal_east-west']?.['value'] &&
          dcimal4(actual_?.['revserveBal_east-west']?.['value'] ?? 0),
        ['park/unpark_east']:
          actual_?.['park/unpark_east'] &&
          dcimal4(actual_?.['park/unpark_east']),
        ['park/unpark_west']:
          actual_?.['park/unpark_west'] &&
          dcimal4(actual_?.['park/unpark_west']),
        ['detail_entry_east-west_ra6Ratio']:
          actual_?.['detail_entry_east-west_ra6Ratio']?.['value'] &&
          dcimal4(actual_?.['detail_entry_east-west_ra6Ratio']?.['value'] ?? 0),
        ['detail_entry_east-west_bvw10Ratio']:
          actual_?.['detail_entry_east-west_bvw10Ratio']?.['value'] &&
          dcimal4(
            actual_?.['detail_entry_east-west_bvw10Ratio']?.['value'] ?? 0,
          ),
        ['shrinkage_others_east']:
          actual_?.['shrinkage_others_east'] &&
          dcimal4(actual_?.['shrinkage_others_east'] ?? 0),
        ['shrinkage_others_west']:
          actual_?.['shrinkage_others_west'] &&
          dcimal4(actual_?.['shrinkage_others_west'] ?? 0),
        ['shrinkage_others_east-west']:
          actual_?.['shrinkage_others_east-west'] &&
          dcimal4(actual_?.['shrinkage_others_east-west'] ?? 0),
        ['minInventoryChange_east']:
          actual_?.['minInventoryChange_east']?.['value'] &&
          dcimal4(actual_?.['minInventoryChange_east']?.['value'] ?? 0),
        ['minInventoryChange_west']:
          actual_?.['minInventoryChange_west']?.['value'] &&
          dcimal4(actual_?.['minInventoryChange_west']?.['value'] ?? 0),
        ['minInventoryChange_east-west']:
          actual_?.['minInventoryChange_east-west']?.['value'] &&
          dcimal4(actual_?.['minInventoryChange_east-west']?.['value'] ?? 0),
        ['dailyImb_east']:
          actual_?.['dailyImb_east']?.['value'] &&
          dcimal4(actual_?.['dailyImb_east']?.['value'] ?? 0),
        ['dailyImb_west']:
          actual_?.['dailyImb_west']?.['value'] &&
          dcimal4(actual_?.['dailyImb_west']?.['value'] ?? 0),
        ['accImb_east']:
          actual_?.['accImb_east']?.['value'] &&
          dcimal4(actual_?.['accImb_east']?.['value'] ?? 0),
        ['accImb_west']:
          actual_?.['accImb_west']?.['value'] &&
          dcimal4(actual_?.['accImb_west']?.['value'] ?? 0),
        ['accImbInv_east']:
          actual_?.['accImbInv_east']?.['value'] &&
          dcimal4(actual_?.['accImbInv_east']?.['value'] ?? 0),
        ['accImbInv_west']:
          actual_?.['accImbInv_west']?.['value'] &&
          dcimal4(actual_?.['accImbInv_west']?.['value'] ?? 0),
        ['dailyImb_total']:
          actual_?.['dailyImb_total']?.['value'] &&
          dcimal4(actual_?.['dailyImb_total']?.['value'] ?? 0),
        ['absimb']:
          actual_?.['absimb']?.['value'] &&
          dcimal4(actual_?.['absimb']?.['value'] ?? 0),
        ['system_level_east']: actual_?.['system_level_east'] ?? 0,
        ['level_percentage_east']:
          actual_?.['level_percentage_east']?.['value'] &&
          dcimal4(actual_?.['level_percentage_east']?.['value'] ?? 0),
        ['energyAdjustIFOFO_east']:
          actual_?.['energyAdjustIFOFO_east']?.['value'] &&
          dcimal4(actual_?.['energyAdjustIFOFO_east']?.['value'] ?? 0),
        ['volumeAdjustIFOFO_east']:
          actual_?.['volumeAdjustIFOFO_east']?.['value'] &&
          dcimal4(actual_?.['volumeAdjustIFOFO_east']?.['value'] ?? 0),
        ['system_level_west']: actual_?.['system_level_west'] ?? 0,
        ['level_percentage_west']:
          actual_?.['level_percentage_west']?.['value'] &&
          dcimal4(actual_?.['level_percentage_west']?.['value'] ?? 0),
        ['energyAdjustIFOFO_west']:
          actual_?.['energyAdjustIFOFO_west']?.['value'] &&
          dcimal4(actual_?.['energyAdjustIFOFO_west']?.['value'] ?? 0),
        ['volumeAdjustIFOFO_west']:
          actual_?.['volumeAdjustIFOFO_west']?.['value'] &&
          dcimal4(actual_?.['volumeAdjustIFOFO_west']?.['value'] ?? 0),
        ['condition_east']: actual_?.['condition_east']?.['value'],
        ['condition_west']: actual_?.['condition_west']?.['value'],
      });

      return [...plan, ...actual];
    });

    console.log('--nresData : ', nresData);
    const formateData = await nresData.map((e: any) => {
      const formateNum = (value) => {
        if (value != null) {
          return this.formatNumberFDecimal(String(value)?.replace(/,/g, ''));
        } else {
          return '';
        }
      };
      const setData = {
        ['Time']: {
          ['(Time)']: e['time'] || '',
          ['Plan/Actual']: e['plan/actual'] || '',
        },
        ['Entry(MMBTU)']: {
          ['East']: formateNum(e['total_entry_east']),
          ['West']: formateNum(e['total_entry_west']),
          ['East-West']: formateNum(e['total_entry_east-west']),
        },
        ['Exit(MMBTU)']: {
          ['East']: formateNum(e['total_exit_east']),
          ['West']: formateNum(e['total_exit_west']),
          ['East-West']: formateNum(e['total_exit_east-west']),
        },
        ['Balancing Gas']: {
          ['East']: formateNum(e['revserveBal_east']),
          ['West']: formateNum(e['revserveBal_west']),
          ['East-West']: formateNum(e['revserveBal_east-west']),
        },
        ['Park/Unpark']: {
          ['East']: formateNum(e['park/unpark_east']),
          ['West']: formateNum(e['park/unpark_west']),
        },
        ['RA#6']: {
          ['Ratio']: formateNum(e['detail_entry_east-west_ra6Ratio']),
        },
        ['BVW#10']: {
          ['Ratio']: formateNum(e['detail_entry_east-west_bvw10Ratio']),
        },
        ['Shrinkage Gas & Others']: {
          ['East']: formateNum(e['shrinkage_others_east']),
          ['West']: formateNum(e['shrinkage_others_west']),
          ['East-West']: formateNum(e['shrinkage_others_east-west']),
        },
        ['Change Min. Inventory']: {
          ['East']: formateNum(e['minInventoryChange_east']),
          ['West']: formateNum(e['minInventoryChange_west']),
          ['East-West']: formateNum(e['minInventoryChange_east-west']),
        },
        ['Imbalance']: {
          ['East']: formateNum(e['dailyImb_east']),
          ['West']: formateNum(e['dailyImb_west']),
        },
        ['Acc Imbalance (Meter) (MMBTU)']: {
          ['East']: formateNum(e['accImb_east']),
          ['West']: formateNum(e['accImb_west']),
        },
        ['Acc Imbalance (Inventory) (MMBTU)']: {
          ['East']: formateNum(e['accImbInv_east']),
          ['West']: formateNum(e['accImbInv_west']),
        },
        ['Total Imbalance']: formateNum(e['dailyImb_total']),
        ['% Total Imbalance']: formateNum(e['absimb']),
        ['System Level (East)']: {
          ['Level']: formateNum(e['system_level_east']),
          ['%']: formateNum(e['level_percentage_east']),
        },
        ['Order (East)']: {
          ['MMBTU']: formateNum(e['energyAdjustIFOFO_east']),
          ['MMSCF']: formateNum(e['volumeAdjustIFOFO_east']),
        },
        ['System Level (West)']: {
          ['Level']: formateNum(e['system_level_west']),
          ['%']: formateNum(e['level_percentage_west']),
        },
        ['Order (West)']: {
          ['MMBTU']: formateNum(e['energyAdjustIFOFO_west']),
          ['MMSCF']: formateNum(e['volumeAdjustIFOFO_west']),
        },
        ['Condition East']: e['condition_east'] || '',
        ['Condition West']: e['condition_west'] || '',
      };
      const filteredData = Object.keys(setData)
        // .filter((key) => filter.includes(key))
        .reduce((obj, key) => {
          obj[key] = setData[key];
          return obj;
        }, {});

      return filteredData;
    });
    await this.exportDataToExcelWithMultiLevelHeader(
      formateData,
      response,
      'Intraday Dashboard',
      true,
    );
  }

  // ทำใหม่ dynamic color hind (sort X) ----------------------------------------------------------------------------

  flattenObjectNew(
    obj: any,
    prefix = '',
    result: any = {},
    pathArray: string[][] = [],
    currentPath: string[] = [],
  ) {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const newPath = [...currentPath, key];

      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        this.flattenObjectNew(
          value,
          prefix ? `${prefix}.${key}` : key,
          result,
          pathArray,
          newPath,
        );
      } else {
        const flatKey = prefix ? `${prefix}.${key}` : key;
        result[flatKey] = value;
        pathArray.push(newPath);
      }
    }

    return { result, pathArray };
  }

  buildHeaderRowsNew(paths: string[][]): string[][] {
    // console.log('paths : ', paths);
    const maxDepth = paths && Math.max(...paths?.map((p) => p.length)) || null;
    const rows: string[][] = Array.from({ length: maxDepth }, () => []);

    for (const path of paths) {
      const padded = [...path];
      while (padded.length < maxDepth) padded.push('');

      for (let i = 0; i < maxDepth; i++) {
        rows[i].push(padded[i]);
      }
    }

    return rows;
  }

  // sheet_add_aoa
  exportDataToExcelWithMultiLevelHeaderNew(
    data: any[],
    response: Response,
    nameFile: string,
    skipFirstRow: boolean,
    headerColorMap,
    cellHighlightMap,
    keyAndDecimalMap?: Record<string, { index: number, decimal: number }[]>
  ): void {
    const wb = XLSX.utils.book_new();
    const flatData = data.map((d) => this.flattenObjectNew(d));
    const allKeys = flatData[0]?.result;
    const allPaths = flatData[0]?.pathArray;

    const headers = allKeys && Object.keys(allKeys) || null;
    const headerRows = allPaths && this.buildHeaderRowsNew(allPaths);
    const ws = XLSX.utils.aoa_to_sheet([]);

    const rowOffset = 1; // ซ่อนแถวแรกไว้

    this.setWorkSheetDataAndStyle({
      ws,
      headerRows,
      rowOffset,
      flatData,
      headers,
      headerColorMap,
      cellHighlightMap,
      keyAndDecimalMap
    });

    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    if (response) {
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD_HH-mm')}_${nameFile}.xlsx"`,
      );
      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.send(excelBuffer);
    } else {
      console.log('excelBuffer : ', excelBuffer);
      console.log('excelBuffer type:', typeof excelBuffer);
      console.log(
        'excelBuffer instanceof Buffer:',
        excelBuffer instanceof Buffer,
      );
      console.log('excelBuffer length:', excelBuffer?.length);
      console.log('------');

      return excelBuffer;
    }
  }

  getFontColor(fillColor: string) {
    return fillColor?.toUpperCase() === '24ADEC' || //#24adec
      fillColor?.toUpperCase() === '3A8FB8' || //#3A8FB8
      fillColor?.toUpperCase() === '25B9D0' || //#25B9D0
      fillColor?.toUpperCase() === '6EA48D' || //#6EA48D
      fillColor?.toUpperCase() === 'DEA477' || //#DEA477
      fillColor?.toUpperCase() === '1573A1' || //#1573A1
      fillColor?.toUpperCase() === '606060' || //#606060
      fillColor?.toUpperCase() === 'A656C4' || //#A656C4
      fillColor?.toUpperCase() === 'E94A4C' || //#E94A4C
      fillColor?.toUpperCase() === 'F0843A' || //#F0843A
      fillColor?.toUpperCase() === 'EAC12A' //#EAC12A
      ? 'FFFFFFFF' //#FFFFFFFF
      : fillColor?.toUpperCase() === 'B8E6FF' //#B8E6FF
        ? '177590' //#177590
        : '000000'; //#000000
  }

  setWorkSheetDataAndStyle({
    ws,
    headerRows,
    rowOffset,
    flatData,
    headers,
    headerColorMap,
    cellHighlightMap,
    keyAndDecimalMap,
    extraHeader
  }: {
    ws: XLSX.WorkSheet;
    headerRows: string[][];
    rowOffset: number;
    flatData: {
      result: any;
      pathArray: string[][];
    }[];
    headers: string[];
    headerColorMap: any;
    cellHighlightMap: any;
    keyAndDecimalMap?: Record<string, { index: number, decimal: number }[]>
    extraHeader?: string[][];
  }) {
    let extraHeaderRowOffset = 0;
    if (extraHeader && extraHeader.length > 0) {
      XLSX.utils.sheet_add_aoa(ws, extraHeader, { origin: rowOffset });
      extraHeaderRowOffset += extraHeader.length

      // ✅ Style extra header rows
      const headerOfExtraHeaderIndex = 0
      for (let C = 0; C < extraHeader[headerOfExtraHeaderIndex].length; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowOffset, c: C });
        if (ws[cellAddress]) {
          const headerValue = headerRows[headerOfExtraHeaderIndex][C];
          const fullPath = headerRows
            .slice(0, headerOfExtraHeaderIndex + 1)
            .map((row) => row[C])
            .filter(Boolean)
            .join('.');
          const fillColor =
            headerColorMap[fullPath] || headerColorMap[headerValue];

          const fontColor = this.getFontColor(fillColor);

          ws[cellAddress].s = {
            font: {
              bold: true,
              color: { rgb: fontColor },
            },
            alignment: {
              horizontal: 'center',
              vertical: 'center',
              wrapText: true,
            },
            fill: { fgColor: { rgb: fillColor || 'F4F4F4' } },
            border: {
              top: { style: 'thin', color: { rgb: '999999' } },
              bottom: { style: 'thin', color: { rgb: '999999' } },
              left: { style: 'thin', color: { rgb: '999999' } },
              right: { style: 'thin', color: { rgb: '999999' } },
            },
          };
        }
      }
    }

    const headerIndexUseForDecimal: Record<number, string> = {}
    if (keyAndDecimalMap && Object.keys(keyAndDecimalMap).length > 0) {
      Object.keys(keyAndDecimalMap).map(key => {
        headerIndexUseForDecimal[headers.findIndex((header: any) => header === key)] = key
      })
    }

    // ✅ ใส่ header
    XLSX.utils?.sheet_add_aoa(ws, headerRows, { origin: rowOffset + extraHeaderRowOffset });

    // ✅ Add data rows
    const jsonData = flatData.map((f) => f.result);
    const rows = jsonData.map((row) => headers.map((key) => row[key]));

    XLSX.utils?.sheet_add_aoa(ws, rows, {
      origin: headerRows.length + rowOffset + extraHeaderRowOffset,
    });

    // ✅ Set number alignment: right
    for (
      let r = headerRows.length + rowOffset + extraHeaderRowOffset;
      r < headerRows.length + rowOffset + extraHeaderRowOffset + rows.length;
      r++
    ) {
      for (let c = 0; c < headers.length; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellAddr];
        if (!cell) continue;

        // if (typeof cell.v === 'number') {
        // Set cell type and format for numbers
        if (keyAndDecimalMap) {
          const decimalKey = Object.keys(keyAndDecimalMap).find((key: any) => key === headers[c])
          if (decimalKey) {
            const rowIndex = r - (headerRows.length + rowOffset + extraHeaderRowOffset)
            const decimalMap = keyAndDecimalMap[decimalKey]?.find((item: any) => item.index === rowIndex)
            if (typeof cell.v === 'number' && decimalMap?.decimal) {
              cell.t = 'n'; // Set cell type to number
              cell.z = `#,##0${decimalMap.decimal == 0 ? '' : '.'}${'0'.repeat(decimalMap.decimal)}`; // Set number format with comma separator and decimal places
            }
          }
        }

        // Set alignment
        cell.s = {
          ...cell.s,
          alignment: {
            ...cell.s?.alignment,
            horizontal: 'right',
          },
        };
        // }
      }
    }

    // ✅ Style header rows
    for (let R = 0; R < headerRows.length; R++) {
      for (let C = 0; C < headers.length; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R + rowOffset + extraHeaderRowOffset, c: C });
        if (ws[cellAddress]) {
          // 🔍 key เต็ม เช่น 'Entry(MMBTU).East'
          const fullKey = headers[C];

          // // 🔍 ดึง label ที่อยู่ใน headerRows แต่ละระดับ
          // const currentHeaderLevel = headerRows.map((row) => row[C]);

          // // 🔍 ลองหาสีแบบจากมากไปน้อย: full path > parent > grandparent ...
          // let fillColor = null;
          // for (let i = currentHeaderLevel.length; i > 0; i--) {
          //   const path = currentHeaderLevel.slice(0, i).join('.');
          //   if (headerColorMap[path]) {
          //     fillColor = headerColorMap[path];
          //     break;
          //   }
          // }

          const headerValue = headerRows[R][C];
          const fullPath = headerRows
            .slice(0, R + 1)
            .map((row) => row[C])
            .filter(Boolean)
            .join('.');
          const fillColor =
            headerColorMap[fullPath] || headerColorMap[headerValue];

          // ให้ font เป็นขาว
          const fontColor = this.getFontColor(fillColor);

          ws[cellAddress].s = {
            font: {
              bold: true,
              color: { rgb: fontColor },
            },
            alignment: {
              horizontal: 'center',
              vertical: 'center',
              wrapText: true,
            },
            fill: { fgColor: { rgb: fillColor || 'F4F4F4' } },
            border: {
              top: { style: 'thin', color: { rgb: '999999' } },
              bottom: { style: 'thin', color: { rgb: '999999' } },
              left: { style: 'thin', color: { rgb: '999999' } },
              right: { style: 'thin', color: { rgb: '999999' } },
            },
          };
        }
      }
    }

    // ✅ Merge cells
    const merges: XLSX.Range[] = [];

    // 🔁 Vertical Merge
    // ✅ Merge header cells vertically (สมบูรณ์)
    for (let C = 0; C < headers.length; C++) {
      const colHeader = headerRows.map((row) => row[C]);
      const firstNonEmpty = colHeader.find((v) => v !== '');
      const isStaticColumn = colHeader.every(
        (v) => v === firstNonEmpty || v === '',
      );

      if (isStaticColumn) {
        // 🔁 merge ทั้งแนวตั้ง ถ้าเป็น static header
        merges.push({
          s: { r: rowOffset + extraHeaderRowOffset, c: C },
          e: { r: headerRows.length - 1 + rowOffset + extraHeaderRowOffset, c: C },
        });
      } else {
        // 🔁 merge เฉพาะช่วงที่เหมือนกันแนวตั้ง
        let startR = 0;
        for (let R = 1; R < headerRows.length; R++) {
          if (headerRows[R][C] !== headerRows[startR][C]) {
            if (R - startR > 1) {
              merges.push({
                s: { r: startR + rowOffset + extraHeaderRowOffset, c: C },
                e: { r: R - 1 + rowOffset + extraHeaderRowOffset, c: C },
              });
            }
            startR = R;
          }
        }
        if (headerRows.length - startR > 1) {
          merges.push({
            s: { r: startR + rowOffset + extraHeaderRowOffset, c: C },
            e: { r: headerRows.length - 1 + rowOffset + extraHeaderRowOffset, c: C },
          });
        }
      }
    }

    // 🔁 Horizontal Merge
    for (let R = 0; R < headerRows.length; R++) {
      let startC = 0;
      for (let C = 1; C <= headers.length; C++) {
        if (
          C === headers.length ||
          headerRows[R][C] !== headerRows[R][startC]
        ) {
          if (C - startC > 1 && headerRows[R][startC] !== '') {
            merges.push({
              s: { r: R + rowOffset + extraHeaderRowOffset, c: startC },
              e: { r: R + rowOffset + extraHeaderRowOffset, c: C - 1 },
            });
          }
          startC = C;
        }
      }
    }

    for (
      let r = headerRows.length + rowOffset + extraHeaderRowOffset;
      r < headerRows.length + rowOffset + extraHeaderRowOffset + rows.length;
      r++
    ) {
      const rowIndex = r - (headerRows.length + rowOffset + extraHeaderRowOffset); // 👈 index จริงของ tempData

      for (let c = 0; c < headers.length; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellAddr];
        if (!cell) continue;

        const key = headers[c]; // เช่น 'Exit(MMBTU).West'
        const bgColor =
          cellHighlightMap[key] && cellHighlightMap[key][rowIndex]
            ? cellHighlightMap[key][rowIndex]
            : null;

        cell.s = {
          ...cell.s,
          alignment: {
            ...cell.s?.alignment,
            horizontal: 'right',
          },
          ...(bgColor && {
            fill: { fgColor: { rgb: bgColor } },
          }),
        };
      }
    }

    // ✅ Size & Visibility
    const totalRows = headerRows.length + rows.length + rowOffset + extraHeaderRowOffset;
    ws['!rows'] = Array.from({ length: totalRows }, (_, i) => {
      return { hpx: i < headerRows.length + rowOffset + extraHeaderRowOffset ? 40 : 30 };
    });
    ws['!rows'][0] = { hidden: true };

    const colWidths = headers.map((_, colIdx) => {
      const maxLength = Math.max(
        ...[
          ...headerRows.map((r) => r[colIdx]),
          ...rows.map((r) => r[colIdx]?.toString() || ''),
        ].map((v) => v?.length || 0),
      );
      return { wch: Math.min(maxLength + 5, 40) };
    });
    ws['!cols'] = colWidths;
    ws['!merges'] = merges;
  }

  // mul
  genDataToExcelWithMultiLevelHeaderNewMultiSheet(
    wb: any,
    data: any[],
    response: Response,
    nameFile: string,
    skipFirstRow: boolean,
    headerColorMap,
    cellHighlightMap,
  ) {
    const flatData = data.map((d) => this.flattenObjectNew(d));
    const allKeys = flatData[0].result;
    const allPaths = flatData[0].pathArray;

    const headers = Object.keys(allKeys);
    const headerRows = allPaths && this.buildHeaderRowsNew(allPaths);
    const ws = XLSX.utils.aoa_to_sheet([]);

    const rowOffset = 1; // ซ่อนแถวแรกไว้

    // ✅ ใส่ header
    XLSX.utils.sheet_add_aoa(ws, headerRows, { origin: rowOffset });

    // ✅ Add data rows
    const jsonData = flatData.map((f) => f.result);
    const rows = jsonData.map((row) => headers.map((key) => row[key]));
    XLSX.utils.sheet_add_aoa(ws, rows, {
      origin: headerRows.length + rowOffset,
    });

    // ✅ Set number alignment: right
    for (
      let r = headerRows.length + rowOffset;
      r < headerRows.length + rowOffset + rows.length;
      r++
    ) {
      for (let c = 0; c < headers.length; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellAddr];
        if (!cell) continue;

        // if (typeof cell.v === 'number') {
        cell.s = {
          ...cell.s,
          alignment: {
            ...cell.s?.alignment,
            horizontal: 'right',
          },
        };
        // }
      }
    }

    // ✅ Style header rows
    for (let R = 0; R < headerRows.length; R++) {
      for (let C = 0; C < headers.length; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R + rowOffset, c: C });
        if (ws[cellAddress]) {
          // 🔍 key เต็ม เช่น 'Entry(MMBTU).East'
          const fullKey = headers[C];

          // // 🔍 ดึง label ที่อยู่ใน headerRows แต่ละระดับ
          // const currentHeaderLevel = headerRows.map((row) => row[C]);

          // // 🔍 ลองหาสีแบบจากมากไปน้อย: full path > parent > grandparent ...
          // let fillColor = null;
          // for (let i = currentHeaderLevel.length; i > 0; i--) {
          //   const path = currentHeaderLevel.slice(0, i).join('.');
          //   if (headerColorMap[path]) {
          //     fillColor = headerColorMap[path];
          //     break;
          //   }
          // }

          const headerValue = headerRows[R][C];
          const fullPath = headerRows
            .slice(0, R + 1)
            .map((row) => row[C])
            .filter(Boolean)
            .join('.');
          const fillColor =
            headerColorMap[fullPath] || headerColorMap[headerValue];

          // ให้ font เป็นขาว
          const fontColor =
            fillColor?.toUpperCase() === '3A8FB8' || //#3A8FB8
              fillColor?.toUpperCase() === '25B9D0' || //#25B9D0
              fillColor?.toUpperCase() === '6EA48D' || //#6EA48D
              fillColor?.toUpperCase() === 'DEA477' || //#DEA477
              fillColor?.toUpperCase() === '1573A1' || //#1573A1
              fillColor?.toUpperCase() === '606060' || //#606060
              fillColor?.toUpperCase() === 'A656C4' || //#A656C4
              fillColor?.toUpperCase() === 'E94A4C' || //#E94A4C
              fillColor?.toUpperCase() === 'F0843A' || //#F0843A
              fillColor?.toUpperCase() === 'EAC12A' //#EAC12A
              ? 'FFFFFFFF' //#FFFFFFFF
              : fillColor?.toUpperCase() === 'B8E6FF' //#B8E6FF
                ? '177590' //#177590
                : '000000'; //#000000

          ws[cellAddress].s = {
            font: {
              bold: true,
              color: { rgb: fontColor },
            },
            alignment: {
              horizontal: 'center',
              vertical: 'center',
              wrapText: true,
            },
            fill: { fgColor: { rgb: fillColor || 'F4F4F4' } },
            border: {
              top: { style: 'thin', color: { rgb: '999999' } },
              bottom: { style: 'thin', color: { rgb: '999999' } },
              left: { style: 'thin', color: { rgb: '999999' } },
              right: { style: 'thin', color: { rgb: '999999' } },
            },
          };
        }
      }
    }

    // ✅ Merge cells
    const merges: XLSX.Range[] = [];

    // 🔁 Vertical Merge
    // ✅ Merge header cells vertically (สมบูรณ์)
    for (let C = 0; C < headers.length; C++) {
      const colHeader = headerRows.map((row) => row[C]);
      const firstNonEmpty = colHeader.find((v) => v !== '');
      const isStaticColumn = colHeader.every(
        (v) => v === firstNonEmpty || v === '',
      );

      if (isStaticColumn) {
        // 🔁 merge ทั้งแนวตั้ง ถ้าเป็น static header
        merges.push({
          s: { r: rowOffset, c: C },
          e: { r: headerRows.length - 1 + rowOffset, c: C },
        });
      } else {
        // 🔁 merge เฉพาะช่วงที่เหมือนกันแนวตั้ง
        let startR = 0;
        for (let R = 1; R < headerRows.length; R++) {
          if (headerRows[R][C] !== headerRows[startR][C]) {
            if (R - startR > 1) {
              merges.push({
                s: { r: startR + rowOffset, c: C },
                e: { r: R - 1 + rowOffset, c: C },
              });
            }
            startR = R;
          }
        }
        if (headerRows.length - startR > 1) {
          merges.push({
            s: { r: startR + rowOffset, c: C },
            e: { r: headerRows.length - 1 + rowOffset, c: C },
          });
        }
      }
    }

    // 🔁 Horizontal Merge
    for (let R = 0; R < headerRows.length; R++) {
      let startC = 0;
      for (let C = 1; C <= headers.length; C++) {
        if (
          C === headers.length ||
          headerRows[R][C] !== headerRows[R][startC]
        ) {
          if (C - startC > 1 && headerRows[R][startC] !== '') {
            merges.push({
              s: { r: R + rowOffset, c: startC },
              e: { r: R + rowOffset, c: C - 1 },
            });
          }
          startC = C;
        }
      }
    }

    for (
      let r = headerRows.length + rowOffset;
      r < headerRows.length + rowOffset + rows.length;
      r++
    ) {
      const rowIndex = r - (headerRows.length + rowOffset); // 👈 index จริงของ tempData

      for (let c = 0; c < headers.length; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellAddr];
        if (!cell) continue;

        const key = headers[c]; // เช่น 'Exit(MMBTU).West'
        const bgColor =
          cellHighlightMap[key] && cellHighlightMap[key][rowIndex]
            ? cellHighlightMap[key][rowIndex]
            : null;

        cell.s = {
          ...cell.s,
          alignment: {
            ...cell.s?.alignment,
            horizontal: 'right',
          },
          ...(bgColor && {
            fill: { fgColor: { rgb: bgColor } },
          }),
        };
      }
    }

    // ✅ Size & Visibility
    const totalRows = headerRows.length + rows.length + rowOffset;
    ws['!rows'] = Array.from({ length: totalRows }, (_, i) => {
      return { hpx: i < headerRows.length + rowOffset ? 40 : 30 };
    });
    ws['!rows'][0] = { hidden: true };

    const colWidths = headers.map((_, colIdx) => {
      const maxLength = Math.max(
        ...[
          ...headerRows.map((r) => r[colIdx]),
          ...rows.map((r) => r[colIdx]?.toString() || ''),
        ].map((v) => v?.length || 0),
      );
      return { wch: Math.min(maxLength + 5, 40) };
    });
    ws['!cols'] = colWidths;
    ws['!merges'] = merges;

    return ws;
  }

  exportDataToExcelWithMultiLevelHeaderNewMultiSheet(
    dataArr: {
      data: any[];
      response?: Response;
      nameSheet?: string;
      skipFirstRow: boolean;
      headerColorMap: any;
      cellHighlightMap: any;
    }[],
    nameFile?: string,
    response?: Response,
  ): void {
    const wb = XLSX.utils.book_new();

    for (let i = 0; i < dataArr.length; i++) {
      const {
        data,
        response,
        nameSheet = `Sheet ${i + 1}`,
        skipFirstRow,
        headerColorMap,
        cellHighlightMap,
      } = dataArr[i];
      const ws = this.genDataToExcelWithMultiLevelHeaderNewMultiSheet(
        wb,
        data,
        response,
        nameSheet,
        skipFirstRow,
        headerColorMap,
        cellHighlightMap,
      );
      XLSX.utils.book_append_sheet(wb, ws, nameSheet);
    }

    // //
    // // ✅ เพิ่ม Sheet2: Summary
    // const summaryData = [
    //   ['Summary Sheet'],
    //   ['Date', getTodayNowAdd7().format('YYYY-MM-DD')],
    //   ['Creator', 'TPA System'],
    // ];
    // const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    // XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // //

    const excelBuffer = XLSX.write(wb, {
      bookType: 'xlsx',
      type: 'buffer',
      compression: true,
    });

    if (response) {
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD_HH-mm')}_${nameFile}.xlsx"`,
      );
      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.send(excelBuffer);
    } else {
      console.log('excelBuffer : ', excelBuffer);
      console.log('excelBuffer type:', typeof excelBuffer);
      console.log(
        'excelBuffer instanceof Buffer:',
        excelBuffer instanceof Buffer,
      );
      console.log('excelBuffer length:', excelBuffer?.length);
      console.log('------');

      return excelBuffer;
    }
  }

  // sort header
  filterNestedObjectByPaths(
    obj: any,
    allowedPaths: string[],
    prefix = '',
  ): any {
    if (typeof obj !== 'object' || obj === null) return obj;

    const result: any = {};

    for (const key of Object.keys(obj)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;

      const isExactMatch = allowedPaths.includes(currentPath);
      const hasChildrenMatch = allowedPaths.some((path) =>
        path.startsWith(`${currentPath}.`),
      );

      if (isExactMatch && !hasChildrenMatch) {
        result[key] = obj[key];
      } else if (hasChildrenMatch) {
        const nested = this.filterNestedObjectByPaths(
          obj[key],
          allowedPaths,
          currentPath,
        );
        if (Object.keys(nested).length > 0) {
          result[key] = nested;
        }
      } else if (isExactMatch && typeof obj[key] !== 'object') {
        result[key] = obj[key];
      }
    }

    return result;
  }

  filterNestedData(data: any[], allowedPaths: string[]): any[] {
    return data.map((item) =>
      this.filterNestedObjectByPaths(item, allowedPaths),
    );
  }

  async balanceIntradayDashboard(
    response: Response,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    const resData: any = await this.balancingService.balanceIntradayDashboard(
      bodys,
      userId,
    );
    // console.log('++++resData : ', resData);
    const shipperNameMaster = bodys?.shipper_id && await this.prisma.group.findFirst({
      where: {
        id_name: bodys?.shipper_id
      },
    })
    const shipperName = shipperNameMaster?.name || null
    // bodys?.shipper_id
    // 
    const formatText = (text?: any) => {
      // DD = DIFFICULT DAY FLOW,OFO = OPERATION FLOW, IF = INSTRACTED FLOW

      switch (text) {
        case 'DD':
          return "DIFFICULT DAY FLOW"
        case 'OFO':
          return "OPERATION FLOW"
        case 'IF':
          return "INSTRACTED FLOW"
        default:
          return text
      }
    }

    const nresData = resData?.flatMap((e: any) => {
      const { plan_, actual_, ...nE } = e;
      const actual = [];
      const plan = [];

      plan?.push({
        ['time']: e['gas_hour'] || '', //
        ['plan/actual']: 'Plan',
        ['total_entry_east']:
          plan_?.['total_entry_east']?.['value'] &&
          this.dcimal4(plan_?.['total_entry_east']?.['value']),
        ['total_entry_west']:
          plan_?.['total_entry_west']?.['value'] &&
          this.dcimal4(plan_?.['total_entry_west']?.['value']),
        ['total_entry_east-west']:
          plan_?.['total_entry_east-west']?.['value'] &&
          this.dcimal4(plan_?.['total_entry_east-west']?.['value']),
        ['total_exit_east']:
          plan_?.['total_exit_east']?.['value'] &&
          this.dcimal4(plan_?.['total_exit_east']?.['value']),
        ['total_exit_west']:
          plan_?.['total_exit_west']?.['value'] &&
          this.dcimal4(plan_?.['total_exit_west']?.['value']),
        ['total_exit_east-west']:
          plan_?.['total_exit_east-west']?.['value'] &&
          this.dcimal4(plan_?.['total_exit_east-west']?.['value']),
        ['revserveBal_east']:
          plan_?.['revserveBal_east']?.['value'] &&
          this.dcimal4(plan_?.['revserveBal_east']?.['value']),
        ['revserveBal_west']:
          plan_?.['revserveBal_west']?.['value'] &&
          this.dcimal4(plan_?.['revserveBal_west']?.['value']),
        ['revserveBal_east-west']:
          plan_?.['revserveBal_east-west']?.['value'] &&
          this.dcimal4(plan_?.['revserveBal_east-west']?.['value']),
        ['park/unpark_east']:
          plan_?.['park/unpark_east'] &&
          this.dcimal4(plan_?.['park/unpark_east']),
        ['park/unpark_west']:
          plan_?.['park/unpark_west'] &&
          this.dcimal4(plan_?.['park/unpark_west']),
        ['detail_entry_east-west_ra6Ratio']:
          plan_?.['detail_entry_east-west_ra6Ratio']?.['value'] &&
          this.dcimal4(
            plan_?.['detail_entry_east-west_ra6Ratio']?.['value'],
          ),
        ['detail_entry_east-west_bvw10Ratio']:
          plan_?.['detail_entry_east-west_bvw10Ratio']?.['value'] &&
          this.dcimal4(
            plan_?.['detail_entry_east-west_bvw10Ratio']?.['value'],
          ),
        ['shrinkage_others_east']:
          plan_?.['shrinkage_others_east'] &&
          this.dcimal4(plan_?.['shrinkage_others_east']),
        ['shrinkage_others_west']:
          plan_?.['shrinkage_others_west'] &&
          this.dcimal4(plan_?.['shrinkage_others_west']),
        ['shrinkage_others_east-west']:
          plan_?.['shrinkage_others_east-west'] &&
          this.dcimal4(plan_?.['shrinkage_others_east-west']),
        ['minInventoryChange_east']:
          plan_?.['minInventoryChange_east']?.['value'] &&
          this.dcimal4(plan_?.['minInventoryChange_east']?.['value']),
        ['minInventoryChange_west']:
          plan_?.['minInventoryChange_west']?.['value'] &&
          this.dcimal4(plan_?.['minInventoryChange_west']?.['value']),
        ['minInventoryChange_east-west']:
          plan_?.['minInventoryChange_east-west']?.['value'] &&
          this.dcimal4(plan_?.['minInventoryChange_east-west']?.['value']),
        ['dailyImb_east']:
          plan_?.['dailyImb_east']?.['value'] &&
          this.dcimal4(plan_?.['dailyImb_east']?.['value']),
        ['dailyImb_west']:
          plan_?.['dailyImb_west']?.['value'] &&
          this.dcimal4(plan_?.['dailyImb_west']?.['value']),
        ['accImb_east']:
          plan_?.['accImb_east']?.['value'] &&
          this.dcimal4(plan_?.['accImb_east']?.['value']),
        ['accImb_west']:
          plan_?.['accImb_west']?.['value'] &&
          this.dcimal4(plan_?.['accImb_west']?.['value']),
        ['accImbInv_east']:
          plan_?.['accImbInv_east']?.['value'] &&
          this.dcimal4(plan_?.['accImbInv_east']?.['value']),
        ['accImbInv_west']:
          plan_?.['accImbInv_west']?.['value'] &&
          this.dcimal4(plan_?.['accImbInv_west']?.['value']),
        ['dailyImb_total']:
          plan_?.['dailyImb_total']?.['value'] &&
          this.dcimal4(plan_?.['dailyImb_total']?.['value']),
        ['absimb']:
          plan_?.['absimb']?.['value'] &&
          this.dcimal4(plan_?.['absimb']?.['value']),
        ['system_level_east']: formatText(plan_?.['system_level_east']),
        ['temp_system_level_east']: (plan_?.['system_level_east']),
        ['level_percentage_east']:
          plan_?.['level_percentage_east']?.['value'] &&
          this.dcimal4(plan_?.['level_percentage_east']?.['value']),
        ['energyAdjustIFOFO_east']:
          plan_?.['energyAdjustIFOFO_east']?.['value'] &&
          this.dcimal4(plan_?.['energyAdjustIFOFO_east']?.['value']),
        ['volumeAdjustIFOFO_east']:
          plan_?.['volumeAdjustIFOFO_east']?.['value'] &&
          this.dcimal4(plan_?.['volumeAdjustIFOFO_east']?.['value']),
        ['system_level_west']: formatText(plan_?.['system_level_west']),
        ['temp_system_level_west']: (plan_?.['system_level_west']),
        ['level_percentage_west']:
          plan_?.['level_percentage_west']?.['value'] &&
          this.dcimal4(plan_?.['level_percentage_west']?.['value']),
        ['energyAdjustIFOFO_west']:
          plan_?.['energyAdjustIFOFO_west']?.['value'] &&
          this.dcimal4(plan_?.['energyAdjustIFOFO_west']?.['value']),
        ['volumeAdjustIFOFO_west']:
          plan_?.['volumeAdjustIFOFO_west']?.['value'] &&
          this.dcimal4(plan_?.['volumeAdjustIFOFO_west']?.['value']),
        ['condition_east']: plan_?.['condition_east']?.['value'],
        ['condition_west']: plan_?.['condition_west']?.['value'],
      });

      actual?.push({
        ['time']: e['gas_hour'] || '', //
        ['plan/actual']: 'Actual',
        ['total_entry_east']:
          actual_?.['total_entry_east']?.['value'] &&
          this.dcimal4(actual_?.['total_entry_east']?.['value']),
        ['total_entry_west']:
          actual_?.['total_entry_west']?.['value'] &&
          this.dcimal4(actual_?.['total_entry_west']?.['value']),
        ['total_entry_east-west']:
          actual_?.['total_entry_east-west']?.['value'] &&
          this.dcimal4(actual_?.['total_entry_east-west']?.['value']),
        ['total_exit_east']:
          actual_?.['total_exit_east']?.['value'] &&
          this.dcimal4(actual_?.['total_exit_east']?.['value']),
        ['total_exit_west']:
          actual_?.['total_exit_west']?.['value'] &&
          this.dcimal4(actual_?.['total_exit_west']?.['value']),
        ['total_exit_east-west']:
          actual_?.['total_exit_east-west']?.['value'] &&
          this.dcimal4(actual_?.['total_exit_east-west']?.['value']),
        ['revserveBal_east']:
          actual_?.['revserveBal_east']?.['value'] &&
          this.dcimal4(actual_?.['revserveBal_east']?.['value']),
        ['revserveBal_west']:
          actual_?.['revserveBal_west']?.['value'] &&
          this.dcimal4(actual_?.['revserveBal_west']?.['value']),
        ['revserveBal_east-west']:
          actual_?.['revserveBal_east-west']?.['value'] &&
          this.dcimal4(actual_?.['revserveBal_east-west']?.['value']),
        ['park/unpark_east']:
          actual_?.['park/unpark_east'] &&
          this.dcimal4(actual_?.['park/unpark_east']),
        ['park/unpark_west']:
          actual_?.['park/unpark_west'] &&
          this.dcimal4(actual_?.['park/unpark_west']),
        ['detail_entry_east-west_ra6Ratio']:
          actual_?.['detail_entry_east-west_ra6Ratio']?.['value'] &&
          this.dcimal4(
            actual_?.['detail_entry_east-west_ra6Ratio']?.['value'],
          ),
        ['detail_entry_east-west_bvw10Ratio']:
          actual_?.['detail_entry_east-west_bvw10Ratio']?.['value'] &&
          this.dcimal4(
            actual_?.['detail_entry_east-west_bvw10Ratio']?.['value'],
          ),
        ['shrinkage_others_east']:
          actual_?.['shrinkage_others_east'] &&
          this.dcimal4(actual_?.['shrinkage_others_east']),
        ['shrinkage_others_west']:
          actual_?.['shrinkage_others_west'] &&
          this.dcimal4(actual_?.['shrinkage_others_west']),
        ['shrinkage_others_east-west']:
          actual_?.['shrinkage_others_east-west'] &&
          this.dcimal4(actual_?.['shrinkage_others_east-west']),
        ['minInventoryChange_east']:
          actual_?.['minInventoryChange_east']?.['value'] &&
          this.dcimal4(actual_?.['minInventoryChange_east']?.['value']),
        ['minInventoryChange_west']:
          actual_?.['minInventoryChange_west']?.['value'] &&
          this.dcimal4(actual_?.['minInventoryChange_west']?.['value']),
        ['minInventoryChange_east-west']:
          actual_?.['minInventoryChange_east-west']?.['value'] &&
          this.dcimal4(
            actual_?.['minInventoryChange_east-west']?.['value'],
          ),
        ['dailyImb_east']:
          actual_?.['dailyImb_east']?.['value'] &&
          this.dcimal4(actual_?.['dailyImb_east']?.['value']),
        ['dailyImb_west']:
          actual_?.['dailyImb_west']?.['value'] &&
          this.dcimal4(actual_?.['dailyImb_west']?.['value']),
        ['accImb_east']:
          actual_?.['accImb_east']?.['value'] &&
          this.dcimal4(actual_?.['accImb_east']?.['value']),
        ['accImb_west']:
          actual_?.['accImb_west']?.['value'] &&
          this.dcimal4(actual_?.['accImb_west']?.['value']),
        ['accImbInv_east']:
          actual_?.['accImbInv_east']?.['value'] &&
          this.dcimal4(actual_?.['accImbInv_east']?.['value']),
        ['accImbInv_west']:
          actual_?.['accImbInv_west']?.['value'] &&
          this.dcimal4(actual_?.['accImbInv_west']?.['value']),
        ['dailyImb_total']:
          actual_?.['dailyImb_total']?.['value'] &&
          this.dcimal4(actual_?.['dailyImb_total']?.['value']),
        ['absimb']:
          actual_?.['absimb']?.['value'] &&
          this.dcimal4(actual_?.['absimb']?.['value']),
        ['system_level_east']: formatText(actual_?.['system_level_east']),
        ['temp_system_level_east']: (actual_?.['system_level_east']),
        ['level_percentage_east']: bodys?.shipper_id ? actual_?.['custom_level_percentage_east']?.['value'] && this.dcimal4(actual_?.['custom_level_percentage_east']?.['value']) : (actual_?.['level_percentage_east']?.['value'] && this.dcimal4(actual_?.['level_percentage_east']?.['value'])),
        ['energyAdjustIFOFO_east']:
          actual_?.['energyAdjustIFOFO_east']?.['value'] &&
          this.dcimal4(actual_?.['energyAdjustIFOFO_east']?.['value']),
        ['volumeAdjustIFOFO_east']:
          actual_?.['volumeAdjustIFOFO_east']?.['value'] &&
          this.dcimal4(actual_?.['volumeAdjustIFOFO_east']?.['value']),
        ['system_level_west']: formatText(actual_?.['system_level_west']),
        ['temp_system_level_west']: (actual_?.['system_level_west']),
        ['level_percentage_west']: bodys?.shipper_id ? actual_?.['custom_level_percentage_west']?.['value'] && this.dcimal4(actual_?.['custom_level_percentage_west']?.['value']) : (actual_?.['level_percentage_west']?.['value'] && this.dcimal4(actual_?.['level_percentage_west']?.['value'])),
        ['energyAdjustIFOFO_west']:
          actual_?.['energyAdjustIFOFO_west']?.['value'] &&
          this.dcimal4(actual_?.['energyAdjustIFOFO_west']?.['value']),
        ['volumeAdjustIFOFO_west']:
          actual_?.['volumeAdjustIFOFO_west']?.['value'] &&
          this.dcimal4(actual_?.['volumeAdjustIFOFO_west']?.['value']),
        ['condition_east']: actual_?.['condition_east']?.['value'],
        ['condition_west']: actual_?.['condition_west']?.['value'],

        // valiedation
        ['validation_accImb_east']: actual_?.['accImb_east']?.['validation'],
        ['validation_accImb_west']: actual_?.['accImb_west']?.['validation'],
        ['validation_accImbInv_east']:
          actual_?.['accImbInv_east']?.['validation'],
        ['validation_accImbInv_west']:
          actual_?.['accImbInv_west']?.['validation'],

        ['validation_system_level_east']: actual_?.['system_level_east'],
        ['validation_level_percentage_east']:
          actual_?.['level_percentage_east']?.['validation'],
        ['validation_system_level_west']: actual_?.['system_level_west'],
        ['validation_level_percentage_west']:
          actual_?.['level_percentage_west']?.['validation'],
      });

      return [...plan, ...actual];
    });
    // 

    const formateData = await nresData.map((e: any) => {
      const formateNum = (value) => {
        if (value != null) {
          return this.formatNumberFDecimal(String(value)?.replace(/,/g, ''));
        } else {
          return '';
        }
      };
      const setData = {
        ['Time']: e['time'] || '',
        ['Plan/Actual']: e['plan/actual'] || '',
        ['Entry(MMBTU)']: {
          ['East']: formateNum(e['total_entry_east']),
          ['West']: formateNum(e['total_entry_west']),
          ['East-West']: formateNum(e['total_entry_east-west']),
        },
        ['Exit(MMBTU)']: {
          ['East']: formateNum(e['total_exit_east']),
          ['West']: formateNum(e['total_exit_west']),
          ['East-West']: formateNum(e['total_exit_east-west']),
        },
        ['Balancing Gas']: {
          ['East']: formateNum(e['revserveBal_east']),
          ['West']: formateNum(e['revserveBal_west']),
          ['East-West']: formateNum(e['revserveBal_east-west']),
        },
        ['Park/Unpark']: {
          ['East']: formateNum(e['park/unpark_east']),
          ['West']: formateNum(e['park/unpark_west']),
        },
        ['RA#6']: {
          ['Ratio']: formateNum(e['detail_entry_east-west_ra6Ratio']),
        },
        ['BVW#10']: {
          ['Ratio']: formateNum(e['detail_entry_east-west_bvw10Ratio']),
        },
        ['Shrinkage Gas & Others']: {
          ['East']: formateNum(e['shrinkage_others_east']),
          ['West']: formateNum(e['shrinkage_others_west']),
          ['East-West']: formateNum(e['shrinkage_others_east-west']),
        },
        ['Change Min. Inventory']: {
          ['East']: formateNum(e['minInventoryChange_east']),
          ['West']: formateNum(e['minInventoryChange_west']),
          ['East-West']: formateNum(e['minInventoryChange_east-west']),
        },
        ['Imbalance']: {
          ['East']: formateNum(e['dailyImb_east']),
          ['West']: formateNum(e['dailyImb_west']),
        },
        ['Acc Imbalance (Meter) (MMBTU)']: {
          ['East']: formateNum(e['accImb_east']),
          ['West']: formateNum(e['accImb_west']),
        },
        ['Acc Imbalance (Inventory) (MMBTU)']: {
          ['East']: formateNum(e['accImbInv_east']),
          ['West']: formateNum(e['accImbInv_west']),
        },
        ['Total Imbalance']: formateNum(e['dailyImb_total']),
        ['% Total Imbalance']: formateNum(e['absimb']),
        ['System Level (East)']: {
          ['Level']: (e['system_level_east']),
          ['%']: formateNum(e['level_percentage_east']),
        },
        ['Order (East)']: {
          ['MMBTU']: formateNum(e['energyAdjustIFOFO_east']),
          ['MMSCF']: formateNum(e['volumeAdjustIFOFO_east']),
        },
        ['System Level (West)']: {
          ['Level']: (e['system_level_west']),
          ['%']: formateNum(e['level_percentage_west']),
        },
        ['Order (West)']: {
          ['MMBTU']: formateNum(e['energyAdjustIFOFO_west']),
          ['MMSCF']: formateNum(e['volumeAdjustIFOFO_west']),
        },
        ['Condition East']: e['condition_east'] || '',
        ['Condition West']: e['condition_west'] || '',
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //   'Time',
    //   'Plan/Actual', //fixed ต้องมี
    //   'Entry(MMBTU)',
    //   'Entry(MMBTU).East',
    //   'Entry(MMBTU).West',
    //   'Entry(MMBTU).East-West',

    //   'Exit(MMBTU)',
    //   'Exit(MMBTU).East',
    //   'Exit(MMBTU).West',
    //   'Exit(MMBTU).East-West',

    //   'Balancing Gas',
    //   'Balancing Gas.East',
    //   'Balancing Gas.West',
    //   'Balancing Gas.East-West',

    //   'Park/Unpark',
    //   'Park/Unpark.East',
    //   'Park/Unpark.West',

    //   'RA#6',
    //   'RA#6.Ratio',

    //   'BVW#10',
    //   'BVW#10.Ratio',

    //   'Shrinkage Gas & Others',
    //   'Shrinkage Gas & Others.East',
    //   'Shrinkage Gas & Others.West',
    //   'Shrinkage Gas & Others.East-West',

    //   'Change Min. Inventory',
    //   'Change Min. Inventory.East',
    //   'Change Min. Inventory.West',
    //   'Change Min. Inventory.East-West',

    //   'Imbalance',
    //   'Imbalance.East',
    //   'Imbalance.West',

    //   'Acc Imbalance (Meter) (MMBTU)',
    //   'Acc Imbalance (Meter) (MMBTU).East',
    //   'Acc Imbalance (Meter) (MMBTU).West',

    //   'Acc Imbalance (Inventory) (MMBTU)',
    //   'Acc Imbalance (Inventory) (MMBTU).East',
    //   'Acc Imbalance (Inventory) (MMBTU).West',

    //   'Total Imbalance',
    //   '% Total Imbalance',

    //   'System Level (East)',
    //   'System Level (East).Level',
    //   'System Level (East).%',

    //   'Order (East)',
    //   'Order (East).MMBTU',
    //   'Order (East).MMSCF',

    //   'System Level (West)',
    //   'System Level (West).Level',
    //   'System Level (West).%',

    //   'Order (West)',
    //   'Order (West).MMBTU',
    //   'Order (West).MMSCF',

    //   'Condition East',
    //   'Condition West',
    // ];

    // header color
    const headerColorMap = {
      Time: '1573A1', // #1573A1
      'Plan/Actual': '1573A1', //fixed ต้องมี
      'Entry(MMBTU)': '1573A1',
      'Entry(MMBTU).East': 'DBE4FF', // #DBE4FF
      'Entry(MMBTU).West': 'FECEE2', // #FECEE2
      'Entry(MMBTU).East-West': 'C7FFD7', // #C7FFD7

      'Exit(MMBTU)': '1573A1',
      'Exit(MMBTU).East': 'DBE4FF',
      'Exit(MMBTU).West': 'FECEE2', // #FECEE2
      'Exit(MMBTU).East-West': 'C7FFD7', // #C7FFD7

      'Balancing Gas': '1573A1',
      'Balancing Gas.East': 'DBE4FF',
      'Balancing Gas.West': 'FECEE2', // #FECEE2
      'Balancing Gas.East-West': 'C7FFD7', // #C7FFD7

      'Park/Unpark': '1573A1',
      'Park/Unpark.East': 'DBE4FF',
      'Park/Unpark.West': 'FECEE2', // #FECEE2

      'RA#6': '1573A1',
      'RA#6.Ratio': 'F2F2F2', // #F2F2F2

      'BVW#10': '1573A1',
      'BVW#10.Ratio': 'F2F2F2', // #F2F2F2

      'Shrinkage Gas & Others': '1573A1',
      'Shrinkage Gas & Others.East': 'DBE4FF',
      'Shrinkage Gas & Others.West': 'FECEE2', // #FECEE2
      'Shrinkage Gas & Others.East-West': 'C7FFD7', // #C7FFD7

      'Change Min. Inventory': '1573A1',
      'Change Min. Inventory.East': 'DBE4FF',
      'Change Min. Inventory.West': 'FECEE2', // #FECEE2
      'Change Min. Inventory.East-West': 'C7FFD7', // #C7FFD7

      Imbalance: '1573A1',
      'Imbalance.East': 'DBE4FF',
      'Imbalance.West': 'FECEE2', // #FECEE2

      'Acc Imbalance (Meter) (MMBTU)': '1573A1',
      'Acc Imbalance (Meter) (MMBTU).East': 'DBE4FF',
      'Acc Imbalance (Meter) (MMBTU).West': 'FECEE2', // #FECEE2

      'Acc Imbalance (Inventory) (MMBTU)': '1573A1',
      'Acc Imbalance (Inventory) (MMBTU).East': 'DBE4FF',
      'Acc Imbalance (Inventory) (MMBTU).West': 'FECEE2', // #FECEE2

      'Total Imbalance': '1573A1',
      '% Total Imbalance': '1573A1',

      'System Level (East)': '1573A1',
      'System Level (East).Level': 'F2F2F2', // #F2F2F2
      'System Level (East).%': 'F2F2F2', // #F2F2F2

      'Order (East)': '1573A1',
      'Order (East).MMBTU': 'F2F2F2', // #F2F2F2
      'Order (East).MMSCF': 'F2F2F2', // #F2F2F2

      'System Level (West)': '1573A1',
      'System Level (West).Level': 'F2F2F2', // #F2F2F2
      'System Level (West).%': 'F2F2F2', // #F2F2F2

      'Order (West)': '1573A1',
      'Order (West).MMBTU': 'F2F2F2', // #F2F2F2
      'Order (West).MMSCF': 'F2F2F2', // #F2F2F2

      'Condition East': '1573A1',
      'Condition West': '1573A1',
    };

    // VALIDATE ORDER EAST กับ WEST
    type VState = 'dd' | 'ofo' | 'if' | 'alert' | 'normal' | '';

    const norm = (s: any): VState => {
      const t = String(s ?? '').trim().toLowerCase();
      if (['dd', 'ofo', 'if', 'alert', 'normal'].includes(t)) return t as VState;
      return '';
    };

    // แกนตั้ง = Validate2 (system level), แกนนอน = Validate1
    // ค่าในช่อง = ผลลัพธ์ (ถ้าไม่มี = '-')
    const MATRIX: any = {
      // Validate2 ↓  \  Validate1 →
      dd: { dd: 'dd', ofo: 'dd', if: 'dd', alert: '', normal: '' },
      ofo: { dd: 'ofo', ofo: 'ofo', if: '', alert: '', normal: '' },
      if: { dd: 'if', ofo: 'if', if: 'if', alert: '', normal: '' },
      alert: { dd: '', ofo: '', if: '', alert: '', normal: '' },
      normal: { dd: '', ofo: '', if: '', alert: '', normal: '' },
      '': { dd: '', ofo: '', if: '', alert: '', normal: '' },
    };

    const COLOR_MAP: Record<VState, string> = {
      // dd: 'E9D2FF',
      // ofo: 'FFC9C9',
      // if: 'FFCEB5',
      // alert: 'FFFFC4',
      // normal: 'E9FFD6',
      // '': 'EAF5F9', // #EAF5F9

      dd: 'E9D2FF',
      ofo: 'FFC9C9',
      if: 'FFCEB5',
      alert: 'FFFFC4',
      normal: 'E9FFD6',
      '': 'EAF5F9',
    };
    const validateOrderEastWest = (
      acc_imb_validate: any,          // Validate1 (Shipper) : DD/OFO/IF/Alert/Normal
      acc_imb_inven_validate: any,    // Validate1 (System)  : DD/OFO/IF/Alert/Normal
      system_level_validate: any,     // Validate2           : DD/OFO/IF/Alert/Normal
    ) => {
      // console.log('acc_imb_validate : ', acc_imb_validate);
      // console.log('acc_imb_inven_validate : ', acc_imb_inven_validate);
      // console.log('system_level_validate : ', system_level_validate);
      // console.log((bodys?.shipper_id && shipperName?.toUpperCase().includes("PTT")) ? acc_imb_inven_validate : acc_imb_validate);

      if (acc_imb_validate == 'MAX') {
        acc_imb_validate = 'dd'
      }
      if (acc_imb_inven_validate == 'MAX') {
        acc_imb_inven_validate = 'dd'
      }

      // isIncludePtt
      // เลือก Validate1 ตามโหมด
      const v1: VState = norm((bodys?.shipper_id && !shipperName?.toUpperCase().includes("PTT")) ? acc_imb_validate : acc_imb_inven_validate);
      const v2: VState = norm(system_level_validate);
      // หาของในเดอะแมททริก
      const resultState: VState = (MATRIX[v2]?.[v1]) ?? '';
      // console.log('resultState : ', resultState);
      // console.log('- - - - - -');

      return COLOR_MAP[resultState]

    };


    const getValidationColorClass = (validation?: string): string => {
      const map: Record<string, string> = {
        // normal: 'BEEB8E',
        // alert: 'F8F889',
        // ofo: 'FFC9C9',
        // dd: 'E9D2FF',
        // if: 'FD9965',

        // max: 'F1E3FF',
        // normal: 'E9FFD6',
        // alert: 'FFFFC4',
        // ofo: 'FFC9C9',
        // dd: 'E9D2FF',
        // if: 'FFCEB5',

        // max: 'E9D2FF',
        // // normal: 'E9FFD6', // เขียว // alert กับ normal ไม่ต้องแสดงสี by P'Nan
        // // alert: 'FFFFC4', // เหลือง // alert กับ normal ไม่ต้องแสดงสี by P'Nan
        // ofo: 'FFC9C9',
        // dd: 'E9D2FF',
        // if: 'FFCEB5',

        // max: 'E9D2FF',
        // // normal: 'E9FFD6', // เขียว // alert กับ normal ไม่ต้องแสดงสี by P'Nan
        // // alert: 'FFFFC4', // เหลือง // alert กับ normal ไม่ต้องแสดงสี by P'Nan
        // ofo: 'FFC9C9',
        // dd: 'E9D2FF',
        // if: 'FFCEB5',

        max: 'E9D2FF',
        normal: 'E9FFD6', // เขียว // alert กับ normal
        alert: 'FFFFC4', // เหลือง // alert กับ normal
        ofo: 'FFC9C9',
        dd: 'E9D2FF',
        if: 'FFCEB5',

      };

      return map[validation?.toLowerCase() ?? ''] ?? 'FFFFFF';
    };

    console.log('filterHeader : ', filterHeader);
    console.log('formateData : ', formateData);
    console.log('nresData : ', nresData);

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (i % 2 === 1) {
            result[key][i] = color;
            // ['level_percentage_east']: bodys?.shipper_id ? actual_?.['custom_level_percentage_east']?.['value'] && this.dcimal4(actual_?.['custom_level_percentage_east']?.['value']) : (actual_?.['level_percentage_east']?.['value'] && this.dcimal4(actual_?.['level_percentage_east']?.['value'])),
            // ['level_percentage_west']: bodys?.shipper_id ? actual_?.['custom_level_percentage_west']?.['value'] && this.dcimal4(actual_?.['custom_level_percentage_west']?.['value']) : (actual_?.['level_percentage_west']?.['value'] && this.dcimal4(actual_?.['level_percentage_west']?.['value'])),
            // 

            if (
              key === 'Order (East).MMBTU'
            ) {
              const colorValition = validateOrderEastWest(nresData[i]?.validation_accImb_east, nresData[i]?.validation_accImbInv_east, nresData[i]?.temp_system_level_east)
              result[key][i] = colorValition;
            }
            if (
              key === 'Order (East).MMSCF'
            ) {
              const colorValition = validateOrderEastWest(nresData[i]?.validation_accImb_east, nresData[i]?.validation_accImbInv_east, nresData[i]?.temp_system_level_east)
              result[key][i] = colorValition;
            }
            if (
              key === 'Order (West).MMBTU'
            ) {
              const colorValition = validateOrderEastWest(nresData[i]?.validation_accImb_west, nresData[i]?.validation_accImbInv_west, nresData[i]?.temp_system_level_west)
              result[key][i] = colorValition;
            }
            if (
              key === 'Order (West).MMSCF'
            ) {
              const colorValition = validateOrderEastWest(nresData[i]?.validation_accImb_west, nresData[i]?.validation_accImbInv_west, nresData[i]?.temp_system_level_west)
              result[key][i] = colorValition;
            }

            if (
              key === 'Acc Imbalance (Meter) (MMBTU).East' &&
              nresData[i]?.['validation_accImb_east']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_accImb_east'],
              );
              result[key][i] = colorValition;
            }
            if (
              key === 'Acc Imbalance (Meter) (MMBTU).West' &&
              nresData[i]?.['validation_accImb_west']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_accImb_west'],
              );
              result[key][i] = colorValition;
            }
            if (
              key === 'Acc Imbalance (Inventory) (MMBTU).East' &&
              nresData[i]?.['validation_accImbInv_east']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_accImbInv_east'],
              );
              result[key][i] = colorValition;
            }
            if (
              key === 'Acc Imbalance (Inventory) (MMBTU).West' &&
              nresData[i]?.['validation_accImbInv_west']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_accImbInv_west'],
              );
              result[key][i] = colorValition;
            }
            if (
              key === 'System Level (East).Level' &&
              nresData[i]?.['validation_system_level_east']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_system_level_east'],
              );
              result[key][i] = colorValition;
            }
            if (
              key === 'System Level (East).%'
              &&
              nresData[i]?.['validation_system_level_east']
              // nresData[i]?.['validation_level_percentage_east']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_system_level_east'],
              );
              result[key][i] = colorValition;
            }
            if (
              key === 'System Level (West).Level' &&
              nresData[i]?.['validation_system_level_west']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_system_level_west'],
              );
              result[key][i] = colorValition;
            }
            if (
              key === 'System Level (West).%'
              &&
              nresData[i]?.['validation_system_level_west']
              // nresData[i]?.['validation_level_percentage_west']
            ) {
              const colorValition = getValidationColorClass(
                nresData[i]?.['validation_system_level_west'],
              );
              result[key][i] = colorValition;
            }
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Intraday Dashboard',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  async epBalancingIntradayBaseInentory(response: Response, payload: any) {
    const { bodys, filter } = payload || {};

    const resData = await this.balancingService.intradayBaseInentoryFromWebService(
      bodys,
      null,
    );
    // console.log('--- resData : ', resData);
    // const FMT = 'DD/MM/YYYY';
    // const sorted_nrestype = _.orderBy(
    //   resData,
    //   [(r) => dayjs(r.gas_day_text_DDMMYY, FMT).valueOf(), ],
    //   ['desc', ]
    // );

    const formateData = await resData?.data?.map((e: any) => {
      const valueDigitKeyPure = (pE: any, nKey: any) => {
        const resultKey =
          e[nKey] !== undefined && e[nKey] !== null
            ? this.dcimal4(e[nKey])
            : null;

        return resultKey;
      };

      const valueDigitKeyTag = (pE: any, nKey: any) => {
        const baseValue = pE['values']?.find(
          (f: any) => f?.['tag'] === nKey,
        )?.value;
        const resultKey =
          baseValue !== undefined && baseValue !== null
            ? this.dcimal4(baseValue)
            : null;

        return resultKey;
      };

      const setData = {
        ['Gas Day']: e['gas_day_text_DDMMYY'] || '',
        ['Gas Hour']: e['gas_hour'] || '', //
        ['Timestamp']: e['timestamp'] || '', //
        ['Zone']: e['zone_text'] || '', //
        ['Mode']: e['mode'] || '', //
        ['HV (BTU/SCF)']: valueDigitKeyPure(e, 'hv'),
        ['Base Inventory Value (MMBTU)']: valueDigitKeyPure(
          e,
          'base_inventory_value',
        ),
        ['High Max (MMBTU)']: valueDigitKeyPure(e, 'high_max'),
        ['High Difficult Day']: valueDigitKeyPure(e, 'high_difficult_day'), // high_dd
        ['High Red (MMBTU)']: valueDigitKeyPure(e, 'high_red'), // high_red
        ['High Orange (MMBTU)']: valueDigitKeyPure(e, 'high_orange'), // high_orange
        ['Alert High (MMBTU)']: valueDigitKeyPure(e, 'alert_high'), // high_alert
        ['Alert Low (MMBTU)']: valueDigitKeyPure(e, 'alert_low'), // low_alert
        ['Low Orange (MMBTU)']: valueDigitKeyPure(e, 'low_orange'), // low_orange
        ['Low Red (MMBTU)']: valueDigitKeyPure(e, 'low_red'), // low_red
        ['Low Difficult Day']: valueDigitKeyPure(e, 'low_difficult_day'), // low_dd
        ['Low Max (MMBTU)']: valueDigitKeyPure(e, 'low_max'), //low_max
      };

      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //     "Gas Day",
    //     "Gas Hour",
    //     "Timestamp",
    //     "Zone",
    //     "Mode",
    //     "HV (BTU/SCF)",
    //     "Base Inventory Value (MMBTU)",
    //     "High Max (MMBTU)",
    //     "High Difficult Day",
    //     "High Red (MMBTU)",
    //     "High Orange (MMBTU)",
    //     "Alert High (MMBTU)",
    //     "Alert Low (MMBTU)",
    //     "Low Orange (MMBTU)",
    //     "Low Red (MMBTU)",
    //     "Low Difficult Day",
    //     "Low Max (MMBTU)"
    // ]

    // header color
    const headerColorMap = {
      'Gas Day': '1573A1', // #1573A1
      'Gas Hour': '1573A1', // #1573A1
      Timestamp: '1573A1', // #1573A1
      Zone: '1573A1', // #1573A1
      Mode: '1573A1', // #1573A1
      'HV (BTU/SCF)': '1573A1', // #1573A1
      'Base Inventory Value (MMBTU)': '1573A1', // #1573A1
      'High Max (MMBTU)': '606060', // #606060
      'High Difficult Day': 'A656C4', // #A656C4
      'High Red (MMBTU)': 'E94A4C', // #E94A4C
      'High Orange (MMBTU)': 'F0843A', // #F0843A
      'Alert High (MMBTU)': 'EAC12A', // #EAC12A
      'Alert Low (MMBTU)': 'EAC12A', // #EAC12A
      'Low Orange (MMBTU)': 'F0843A', // #F0843A
      'Low Red (MMBTU)': 'E94A4C', // #E94A4C
      'Low Difficult Day': 'A656C4', // #A656C4
      'Low Max (MMBTU)': '606060', // #606060
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (key === 'High Max (MMBTU)') {
            result[key][i] = 'C9C9C9'; //#C9C9C9
          }
          if (key === 'High Difficult Day') {
            result[key][i] = 'f6f0f9'; //#f6f0f9
          }
          if (key === 'High Red (MMBTU)') {
            result[key][i] = 'fceeed'; //#fceeed
          }
          if (key === 'High Orange (MMBTU)') {
            result[key][i] = 'fcf3ed'; //#fcf3ed
          }
          if (key === 'Alert High (MMBTU)') {
            result[key][i] = 'fef9ee'; //#fef9ee
          }
          if (key === 'Alert Low (MMBTU)') {
            result[key][i] = 'fef9ee'; //#fef9ee
          }
          if (key === 'Low Orange (MMBTU)') {
            result[key][i] = 'fcf3ed'; //#fcf3ed
          }
          if (key === 'Low Red (MMBTU)') {
            result[key][i] = 'fceeed'; //#fceeed
          }
          if (key === 'Low Difficult Day') {
            result[key][i] = 'f6f0f9'; //#f6f0f9
          }
          if (key === 'Low Max (MMBTU)') {
            result[key][i] = 'C9C9C9'; //#C9C9C9
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Intraday Base Inventory',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  async epBalancingIntradayBaseInentoryShipper(
    response: Response,
    payload: any,
  ) {
    const { bodys, filter } = payload || {};

    // const resData = await this.balancingService.intradayBaseInentoryShipper(
    //   bodys,
    //   null,
    // );
    const resData = await this.balancingService.intradayBaseInentoryShipper2(
      bodys,
      null,
    );
    const formateData = await resData.map((e: any) => {
      const valueDigitKeyPure = (pE: any, nKey: any) => {
        const resultKey =
          e[nKey] !== undefined && e[nKey] !== null
            ? this.dcimal4(e[nKey])
            : null;

        return resultKey;
      };

      const valueDigitKeyTag = (pE: any, nKey: any) => {
        const baseValue = pE['values']?.find(
          (f: any) => f?.['tag'] === nKey,
        )?.value;
        const resultKey =
          baseValue !== undefined && baseValue !== null
            ? this.dcimal4(baseValue)
            : null;

        return resultKey;
      };

      const setData = {
        ['Gas Day']: dayjs(e['gas_day'], 'YYYY-MM-DD').format('DD/MM/YYYY'),
        ['Gas Hour']:
          (e['gas_hour'] &&
            `${e?.gas_hour > 10 ? e?.gas_hour + ':00' : '0' + e?.gas_hour + ':00'}`) ||
          '', //
        ['Timestamp']:
          dayjs(e['timestamp'], 'DD/MM/YYYY HH:mm:ss').format(
            'DD/MM/YYYY HH:mm:ss',
          ) || '', //
        ['Zone']: e['zone'] || '', //
        ['Mode']: e['mode'] || '', //
        ['Shipper Name']: e['groupObj']?.['name'] || '', //
        ['HV (BTU/SCF)']: valueDigitKeyPure(e, 'heatingValue_base'),
        ['Base Inventory Value (MMBTU)']: valueDigitKeyTag(e, 'baseInv'),
        ['High Max (MMBTU)']: valueDigitKeyTag(e, 'high_max'),
        ['High Difficult Day (MMBTU)']: valueDigitKeyTag(e, 'high_dd'), // high_dd //https://app.clickup.com/t/86eujrg9r
        ['High Red (MMBTU)']: valueDigitKeyTag(e, 'high_red'), // high_red
        ['High Orange (MMBTU)']: valueDigitKeyTag(e, 'high_orange'), // high_orange
        ['Alert High (MMBTU)']: valueDigitKeyTag(e, 'high_alert'), // high_alert
        ['Alert Low (MMBTU)']: valueDigitKeyTag(e, 'low_alert'), // low_alert
        ['Low Orange (MMBTU)']: valueDigitKeyTag(e, 'low_orange'), // low_orange
        ['Low Red (MMBTU)']: valueDigitKeyTag(e, 'low_red'), // low_red
        ['Low Difficult Day (MMBTU)']: valueDigitKeyTag(e, 'low_dd'), // low_dd //https://app.clickup.com/t/86eujrg9r
        ['Low Max (MMBTU)']: valueDigitKeyTag(e, 'low_max'), //low_max
      };

      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //     "Gas Day",
    //     "Gas Hour",
    //     "Timestamp",
    //     "Zone",
    //     "Mode",
    //     "Shipper Name",
    //     "HV (BTU/SCF)",
    //     "Base Inventory Value (MMBTU)",
    //     "High Max (MMBTU)",
    //     "High Difficult Day",
    //     "High Red (MMBTU)",
    //     "High Orange (MMBTU)",
    //     "Alert High (MMBTU)",
    //     "Alert Low (MMBTU)",
    //     "Low Orange (MMBTU)",
    //     "Low Red (MMBTU)",
    //     "Low Difficult Day",
    //     "Low Max (MMBTU)"
    // ]

    // header color
    const headerColorMap = {
      'Gas Day': '1573A1', // #1573A1
      'Gas Hour': '1573A1', // #1573A1
      Timestamp: '1573A1', // #1573A1
      Zone: '1573A1', // #1573A1
      Mode: '1573A1', // #1573A1
      'Shipper Name': '1573A1', // #1573A1
      'HV (BTU/SCF)': '1573A1', // #1573A1
      'Base Inventory Value (MMBTU)': '1573A1', // #1573A1
      'High Max (MMBTU)': '606060', // #606060
      'High Difficult Day (MMBTU)': 'A656C4', // #A656C4
      'High Red (MMBTU)': 'E94A4C', // #E94A4C
      'High Orange (MMBTU)': 'F0843A', // #F0843A
      'Alert High (MMBTU)': 'EAC12A', // #EAC12A
      'Alert Low (MMBTU)': 'EAC12A', // #EAC12A
      'Low Orange (MMBTU)': 'F0843A', // #F0843A
      'Low Red (MMBTU)': 'E94A4C', // #E94A4C
      'Low Difficult Day (MMBTU)': 'A656C4', // #A656C4
      'Low Max (MMBTU)': '606060', // #606060
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (key === 'High Max (MMBTU)') {
            result[key][i] = 'C9C9C9'; //#C9C9C9
          }
          if (key === 'High Difficult Day') {
            result[key][i] = 'f6f0f9'; //#f6f0f9
          }
          if (key === 'High Red (MMBTU)') {
            result[key][i] = 'fceeed'; //#fceeed
          }
          if (key === 'High Orange (MMBTU)') {
            result[key][i] = 'fcf3ed'; //#fcf3ed
          }
          if (key === 'Alert High (MMBTU)') {
            result[key][i] = 'fef9ee'; //#fef9ee
          }
          if (key === 'Alert Low (MMBTU)') {
            result[key][i] = 'fef9ee'; //#fef9ee
          }
          if (key === 'Low Orange (MMBTU)') {
            result[key][i] = 'fcf3ed'; //#fcf3ed
          }
          if (key === 'Low Red (MMBTU)') {
            result[key][i] = 'fceeed'; //#fceeed
          }
          if (key === 'Low Difficult Day') {
            result[key][i] = 'f6f0f9'; //#f6f0f9
          }
          if (key === 'Low Max (MMBTU)') {
            result[key][i] = 'C9C9C9'; //#C9C9C9
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Intraday Base Inventory Shipper',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  async epBalancinginstructedOperationFlowShippers(
    response: Response,
    payload: any,
    userId: any,
  ) {
    // const userId = 99999
    const { bodys, filter } = payload || {};
    const resData: any =
      await this.balancingService.instructedOperationFlowShippers(
        bodys,
        userId,
      );

    const groupMasterCheck = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
    });

    const shipperMaster = await this.prisma.group.findMany({
      where: {

      },
    });

    const shipperIdName = groupMasterCheck?.id_name;
    const shipperName = groupMasterCheck?.name;
    const userType = groupMasterCheck?.user_type_id;
    console.log('resData : ', resData);
    const nresData = resData?.filter((f: any) => {
      return (
        f?.shipperData?.length > 0 &&
        f?.level !== "NORMAL" &&
        f?.level !== "ALERT" &&
        f?.level !== "Alert"
      )
    })?.flatMap((e: any) => {
      const { valuesData, shipperData, ...nE } = e;
      const green = [];
      const shipperUse = [];

      const valueDigitKeyPure3 = (pE: any, nKey: any) => {
        const resultKey =
          pE?.[nKey] !== undefined && pE?.[nKey] !== null
            ? this.dcimal3(pE?.[nKey])
            : null;

        return resultKey;
      };

      const valueDigitKeyPure = (pE: any, nKey: any) => {
        const resultKey =
          pE?.[nKey] !== undefined && pE?.[nKey] !== null
            ? this.dcimal4(pE?.[nKey])
            : null;

        return resultKey;
      };

      const valueDigitKeyTag = (pE: any, nKey: any) => {
        const baseValue = pE?.[nKey];
        const resultKey =
          baseValue !== undefined && baseValue !== null
            ? this.dcimal4(baseValue)
            : null;

        return resultKey;
      };

      if (userType === 3) {
        for (let i = 0; i < shipperData.length; i++) {
          const lengthSubmissionFile =
            (shipperData[i]?.['file'].length > 0 &&
              shipperData[i]?.['file']
                .map((url: any) => `${url?.url}`)
                .join(',')) ||
            '';
          const lengthSubmissionComment =
            (shipperData[i]?.['comment'].length > 0 &&
              shipperData[i]?.['comment']
                .map((comment: any) => `${comment?.comment}`)
                .join(',')) ||
            '';

          if (shipperIdName === shipperData[i]?.['shipperName']) {
            shipperUse?.push({
              ['Timestamp']: shipperData[i]?.['timestamp'] || '', //
              ['Hourly']:
                e['gas_hour'] &&
                `${e['gas_hour'] > 10 ? e['gas_hour'] + ':00' : '0' + e['gas_hour'] + ':00'}`,
              ['Shipper Name']: shipperData[i]?.['shipperName'] && shipperMaster?.find((f: any) => f?.id_name === shipperData[i]?.['shipperName'])?.name || '',
              ['Zone']: e['zone'] || '',
              ['Acc. Imbalance / Acc. Imbalance Inventory (MMBTU)']:
                valueDigitKeyPure(shipperData[i], 'accImb_or_accImbInv'),
              ['Acc.Margin (MMBTU)']: valueDigitKeyPure(
                shipperData[i],
                'accMargin',
              ),
              ['Flow Type']: valueDigitKeyPure(shipperData[i], 'flow_type'),
              ['Energy Adjustment (MMBTU)']: valueDigitKeyPure(
                shipperData[i],
                'energyAdjust',
              ),
              ['Energy Flow Rate Adjustment (MMBTU/H)']: valueDigitKeyPure(
                shipperData[i],
                'energyAdjustRate_mmbtuh',
              ),
              ['Energy Flow Rate Adjustment (MMBTU/D)']: valueDigitKeyPure(
                shipperData[i],
                'energyAdjustRate_mmbtud',
              ),
              ['Volume Adjustment (MMBTU)']: valueDigitKeyPure(
                shipperData[i],
                'volumeAdjust',
              ),
              ['Volume Flow Rate Adjustment (MMSCF/H)']: valueDigitKeyPure(
                shipperData[i],
                'volumeAdjustRate_mmscfh',
              ),
              ['Volume Flow Rate Adjustment (MMSCFD)']: valueDigitKeyPure(
                shipperData[i],
                'volumeAdjustRate_mmscfd',
              ),
              ['ResolvedTime (Hr.)']: shipperData[i]?.['resolveHour'] || '',
              ['HV (BTU/SCF)']: valueDigitKeyPure3(
                shipperData[i],
                'heatingValue',
              ),
              //heatingValue
              ['File']:
                lengthSubmissionFile.length > 32767
                  ? lengthSubmissionFile.slice(0, 32700) +
                  'เกินลิมิตแล้วโปรดดูที่เว็บ'
                  : lengthSubmissionFile,
              ['Comment']:
                lengthSubmissionComment.length > 32767
                  ? lengthSubmissionComment.slice(0, 32700) +
                  'เกินลิมิตแล้วโปรดดูที่เว็บ'
                  : lengthSubmissionComment,
              ['Publicate']: shipperData[i]?.['publication'] || '',
            });
          }
        }
      } else {
        green?.push({
          ['Timestamp']: e['valuesData']?.['timestamp'] || '', //
          ['Hourly']:
            e['gas_hour'] &&
            `${e['gas_hour'] > 10 ? e['gas_hour'] + ':00' : '0' + e['gas_hour'] + ':00'}`,
          ['Shipper Name']: e['valuesData']?.['shipperName'] || '',
          ['Zone']: e['zone'] || '',
          ['Acc. Imbalance / Acc. Imbalance Inventory (MMBTU)']:
            valueDigitKeyTag(e['valuesData'], 'accImb_or_accImbInv'),
          ['Acc.Margin (MMBTU)']: valueDigitKeyTag(
            e['valuesData'],
            'accMargin',
          ),
          ['Flow Type']: valueDigitKeyTag(e['valuesData'], 'flow_type'),
          ['Energy Adjustment (MMBTU)']: valueDigitKeyTag(
            e['valuesData'],
            'energyAdjust',
          ),
          ['Energy Flow Rate Adjustment (MMBTU/H)']: valueDigitKeyTag(
            e['valuesData'],
            'energyAdjustRate_mmbtuh',
          ),
          ['Energy Flow Rate Adjustment (MMBTU/D)']: valueDigitKeyTag(
            e['valuesData'],
            'energyAdjustRate_mmbtud',
          ),
          ['Volume Adjustment (MMBTU)']: valueDigitKeyTag(
            e['valuesData'],
            'volumeAdjust',
          ),
          ['Volume Flow Rate Adjustment (MMSCF/H)']: valueDigitKeyTag(
            e['valuesData'],
            'volumeAdjustRate_mmscfh',
          ),
          ['Volume Flow Rate Adjustment (MMSCFD)']: valueDigitKeyTag(
            e['valuesData'],
            'volumeAdjustRate_mmscfd',
          ),
          ['ResolvedTime (Hr.)']: e['valuesData']?.['resolveHour'] || '',
          ['HV (BTU/SCF)']: valueDigitKeyPure3(e['valuesData'], 'heatingValue'),
          ['File']: '',
          ['Comment']: '',
          // ['File']:  e['valuesData']?.['file'] || '',
          // ['Comment']:  e['valuesData']?.['comment'] || '',
          ['Publicate']: e['valuesData']?.['publication'] || '',
          ['grees']: true,
        });

        for (let i = 0; i < shipperData.length; i++) {
          const lengthSubmissionFile =
            (shipperData[i]?.['file'].length > 0 &&
              shipperData[i]?.['file']
                .map((url: any) => `${url?.url}`)
                .join(',')) ||
            '';
          const lengthSubmissionComment =
            (shipperData[i]?.['comment'].length > 0 &&
              shipperData[i]?.['comment']
                .map((comment: any) => `${comment?.comment}`)
                .join(',')) ||
            '';

          shipperUse?.push({
            ['Timestamp']: shipperData[i]?.['timestamp'] || '', //
            ['Hourly']:
              e['gas_hour'] &&
              `${e['gas_hour'] > 10 ? e['gas_hour'] + ':00' : '0' + e['gas_hour'] + ':00'}`,
            ['Shipper Name']: shipperData[i]?.['shipperName'] && shipperMaster?.find((f: any) => f?.id_name === shipperData[i]?.['shipperName'])?.name || '',
            ['Zone']: e['zone'] || '',
            ['Acc. Imbalance / Acc. Imbalance Inventory (MMBTU)']:
              valueDigitKeyPure(shipperData[i], 'accImb_or_accImbInv'),
            ['Acc.Margin (MMBTU)']: valueDigitKeyPure(
              shipperData[i],
              'accMargin',
            ),
            ['Flow Type']: valueDigitKeyPure(shipperData[i], 'flow_type'),
            ['Energy Adjustment (MMBTU)']: valueDigitKeyPure(
              shipperData[i],
              'energyAdjust',
            ),
            ['Energy Flow Rate Adjustment (MMBTU/H)']: valueDigitKeyPure(
              shipperData[i],
              'energyAdjustRate_mmbtuh',
            ),
            ['Energy Flow Rate Adjustment (MMBTU/D)']: valueDigitKeyPure(
              shipperData[i],
              'energyAdjustRate_mmbtud',
            ),
            ['Volume Adjustment (MMBTU)']: valueDigitKeyPure(
              shipperData[i],
              'volumeAdjust',
            ),
            ['Volume Flow Rate Adjustment (MMSCF/H)']: valueDigitKeyPure(
              shipperData[i],
              'volumeAdjustRate_mmscfh',
            ),
            ['Volume Flow Rate Adjustment (MMSCFD)']: valueDigitKeyPure(
              shipperData[i],
              'volumeAdjustRate_mmscfd',
            ),
            ['ResolvedTime (Hr.)']: shipperData[i]?.['resolveHour'] || '',
            ['HV (BTU/SCF)']: valueDigitKeyPure3(shipperData[i], 'heatingValue'),
            //heatingValue
            ['File']:
              lengthSubmissionFile.length > 32767
                ? lengthSubmissionFile.slice(0, 32700) +
                'เกินลิมิตแล้วโปรดดูที่เว็บ'
                : lengthSubmissionFile,
            ['Comment']:
              lengthSubmissionComment.length > 32767
                ? lengthSubmissionComment.slice(0, 32700) +
                'เกินลิมิตแล้วโปรดดูที่เว็บ'
                : lengthSubmissionComment,
            ['Publicate']: shipperData[i]?.['publication'] || '',
          });
        }
      }
      return [...green, ...shipperUse];
    });

    console.log('--nresData : ', nresData);
    const formateData = await nresData?.map((e: any) => {
      const setData = {
        ['Publicate']: !e['Shipper Name']
          ? ''
          : e['Publicate']
            ? 'Public'
            : 'Unpublic',
        ['Timestamp']: e['Timestamp'] || '',
        ['Hourly']: e['Hourly'] || '',
        ['Shipper Name']: e['Shipper Name'] || '',
        ['Zone']: e['Zone'] || '',
        ['Acc. Imbalance / Acc. Imbalance Inventory (MMBTU)']:
          e['Acc. Imbalance / Acc. Imbalance Inventory (MMBTU)'] || '',
        ['Acc.Margin (MMBTU)']: e['Acc.Margin (MMBTU)'] || '',
        ['Flow Type']: e['Flow Type'] || '',
        ['Energy Adjustment (MMBTU)']: e['Energy Adjustment (MMBTU)'] || '',
        ['Energy Flow Rate Adjustment (MMBTU/H)']:
          e['Energy Flow Rate Adjustment (MMBTU/H)'] || '',
        ['Energy Flow Rate Adjustment (MMBTU/D)']:
          e['Energy Flow Rate Adjustment (MMBTU/D)'] || '',
        ['Volume Adjustment (MMBTU)']: e['Volume Adjustment (MMBTU)'] || '',
        ['Volume Flow Rate Adjustment (MMSCF/H)']:
          e['Volume Flow Rate Adjustment (MMSCF/H)'] || '',
        ['Volume Flow Rate Adjustment (MMSCFD)']:
          e['Volume Flow Rate Adjustment (MMSCFD)'] || '',
        ['ResolvedTime (Hr.)']: e['ResolvedTime (Hr.)'] || '',
        ['HV (BTU/SCF)']: e['HV (BTU/SCF)'] || '',
        ['File']: e['File'] || '',
        ['Comment']: e['Comment'] || '',
        ['grees']: e['grees'] ? true : false,
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      //

      return filteredData;
    });

    // ---------------- manage table excel
    // console.log('formateData : ', formateData);

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //     "Publicate",
    //     "Timestamp",
    //     "Hourly",
    //     "Shipper Name",
    //     "Zone",
    //     "Acc. Imbalance / Acc. Imbalance Inventory (MMBTU)",
    //     "Acc.Margin (MMBTU)",
    //     "Flow Type",
    //     "Energy Adjustment (MMBTU)",
    //     "Energy Flow Rate Adjustment (MMBTU/H))",
    //     "Energy Flow Rate Adjustment (MMBTU/D)",
    //     "Volume Adjustment (MMBTU)",
    //     "Volume Flow Rate Adjustment (MMSCF/H)",
    //     "Volume Flow Rate Adjustment (MMSCFD)",
    //     "ResolvedTime (Hr.)",
    //     "HV (BTU/SCF)",
    //     "File",
    //     "Comment"
    // ]

    // header color
    const headerColorMap = {
      Publicate: '1573A1', // #1573A1
      Timestamp: '1573A1', // #1573A1
      Hourly: '1573A1', // #1573A1
      'Shipper Name': '1573A1', // #1573A1
      Zone: '1573A1', // #1573A1
      'Acc. Imbalance / Acc. Imbalance Inventory (MMBTU)': '1573A1', // #1573A1
      'Acc.Margin (MMBTU)': '1573A1', // #1573A1
      'Flow Type': '1573A1', // #1573A1
      'Energy Adjustment (MMBTU)': '1573A1', // #1573A1
      'Energy Flow Rate Adjustment (MMBTU/H))': '1573A1', // #1573A1
      'Energy Flow Rate Adjustment (MMBTU/D)': '1573A1', // #1573A1
      'Volume Adjustment (MMBTU)': '1573A1', // #1573A1
      'Volume Flow Rate Adjustment (MMSCF/H)': '1573A1', // #1573A1
      'Volume Flow Rate Adjustment (MMSCFD)': '1573A1', // #1573A1
      'ResolvedTime (Hr.)': '1573A1', // #1573A1
      'HV (BTU/SCF)': '1573A1', // #1573A1
      File: '1573A1', // #1573A1
      Comment: '1573A1', // #1573A1
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (data[i]?.['grees']) {
            result[key][i] = 'e8ffee'; //#e8ffee
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Operation Flow and Instructed Flow',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  async epBalancingIntradayBalancingReport(
    response: Response,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    //
    const resData: any = await this.balancingService.intradayBalancingReport(
      bodys,
      userId,
    );

    console.log('--- resData : ', resData);
    // const FMT = 'YYYY-MM-DD';
    // const sorted_nrestype = _.orderBy(
    //   resData,
    //   [(r) => dayjs(r.gas_day, FMT).valueOf(), ],
    //   ['asc', ]
    // );

    const keyHead = [
      'custom_color',
      'custom_publication', // publication
      'custom_gas_day', // Gas Day
      'custom_gas_hour', // Gas Hour
      'custom_timestamp', // timestamp
      'custom_shipper_id', // Shipper
      'custom_shipper_name', // Shipper Name
      'custom_contract_code', // Contract Code
      'custom_plan_actual', // new
      'total_entry_east',
      'total_entry_west',
      'total_entry_east-west',
      'total_exit_east',
      'total_exit_west',
      'total_exit_east-west',
      'imbZone_east',
      'imbZone_west',
      'imbZone_total',
      'instructedFlow_east',
      'instructedFlow_west',
      'instructedFlow_east-west',
      'shrinkage_east',
      'shrinkage_west',
      'park_east',
      'park_west',
      'Unpark_east',
      'Unpark_west',
      'SodPark_east',
      'SodPark_west',
      'EodPark_east',
      'EodPark_west',
      'minInventoryChange_east',
      'minInventoryChange_west',
      'reserveBal_east',
      'reserveBal_west',
      'adjustDailyImb_east',
      'adjustDailyImb_west',
      'ventGas_east',
      'ventGas_west',
      'commissioningGas_east',
      'commissioningGas_west',
      'otherGas_east',
      'otherGas_west',
      'dailyImb_east',
      'dailyImb_west',
      'aip',
      'ain',
      'absimb',
      'custom_abs_absimb', //ABS(absimb)
      'accImbMonth_east',
      'accImbMonth_west',
      'accImb_east',
      'accImb_west',
      'minInventory_east',
      'minInventory_west',
      'detail_entry_east_gsp',
      'detail_entry_east_bypassGas',
      'detail_entry_east_lng',
      'custom_detail_entry_east_', //detail_entry_east_ อื่นบวกกัน other
      'detail_entry_west_yadana',
      'detail_entry_west_yetagun',
      'detail_entry_west_zawtika',
      'custom_detail_entry_west_', //detail_entry_west_ อื่นบวกกัน other
      'detail_entry_east-west_ra6East',
      'detail_entry_east-west_ra6West',
      'detail_entry_east-west_bvw10East',
      'detail_entry_east-west_bvw10West',
      'detail_exit_east_egat',
      'detail_exit_east_ipp',
      'custom_detail_exit_east_', //detail_exit_east_ อื่นบวกกัน other
      'detail_exit_west_egat',
      'detail_exit_west_ipp',
      'custom_detail_exit_west_', //detail_exit_west_ อื่นบวกกัน other
      'detail_exit_east-west_egat',
      'detail_exit_east-west_ipp',
      'custom_detail_exit_east-west_', //detail_exit_east-west_ อื่นบวกกัน other
      'detail_exit_east_F2andG',
      'detail_exit_west_F2andG',
      'detail_exit_E_east',
      'detail_exit_E_west',
    ];

    // arr to obj
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
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

    const valueDigitKeyPure = (pE: any) => {
      const resultKey =
        pE !== undefined && pE !== null ? this.dcimal4(pE) : null;

      return resultKey;
    };

    const sumDetail = (values: any, startWithTag: string, excludedTags: string[]) => {
      if (!values) return 0.0000;
      let numCalc = 0
      for (let ix = 0; ix < excludedTags.length; ix++) {
        // startWithTag + excludedTags[ix]
        const kN = values[startWithTag + excludedTags[ix]]
        if (kN) {
          numCalc += kN
        }
      }

      return this.formatNumberFDecimal(numCalc)

    };

    const listCustoms = (keys: any, valueObj: any) => {
      const result: any = {};
      keys.forEach((key) => {
        if (key === 'custom_gas_day') {
          result[key] = valueObj[key];
        } else if (key === 'custom_shipper_id') {
          result[key] = valueObj[key];
        } else if (key === 'custom_shipper_name') {
          result[key] = valueObj[key];
        } else if (key === 'custom_contract_code') {
          result[key] = valueObj[key];
        } else if (key === 'custom_gas_hour') {
          result[key] = valueObj[key] || '';
        } else if (key === 'custom_timestamp') {
          result[key] = valueObj[key] || '';
        } else if (key === 'custom_plan_actual') {
          result[key] = valueObj[key];
        } else if (key === 'custom_abs_absimb') {
          result[key] = Math.abs(valueObj['absimb']) ?? '';
        } else if (key === 'custom_detail_entry_east_') {
          result[key] = '';
        } else if (key === 'custom_detail_entry_west_') {
          result[key] = '';
        } else if (key === 'custom_detail_exit_east_') {
          result[key] = '';
        } else if (key === 'custom_detail_exit_west_') {
          result[key] = '';
        } else if (key === 'custom_detail_exit_east-west_') {
          result[key] = '';
        } else if (key === 'custom_publication') {
          result[key] = valueObj[key] || '';
        } else if (key === 'custom_color') {
          // console.log('custom_color');
          result[key] = valueObj[key] || '';
        } else {
          // valueDigitKeyPure(shipperData[i], 'heatingValue'),
          // console.log('valueObj[key] : ', valueObj[key]);
          result[key] = valueDigitKeyPure(valueObj[key]);
        }
      });
      return result;
    };

    // console.log('______resData : ', resData);
    const newData = resData?.flatMap((e: any) => {
      const {
        totalAllPlanning,
        totalAllActual,
        shipperData,
        gas_day,
        request_number,
        execute_timestamp,
        ...nE
      } = e;
      // custom_shipper_id
      const totalShipper = shipperData?.flatMap((sp: any) => {
        const {
          shipper,
          totalShipperPlanning,
          totalShipperActual,
          contractData: contract_data,
          ...nSp
        } = sp;
        // console.log('shipper : ', shipper);
        const contractData = contract_data?.flatMap((cd: any) => {
          const contractObjPlanning = listCustoms(keyHead, {
            ...cd?.valueContractPlanning,
            // custom_plan_actual: 'Planning (Nomination)',
            custom_plan_actual: 'Planning',
            custom_gas_day: cd?.valueContractPlanning?.gas_day || '',
            custom_shipper_id: shipper || '',
            custom_shipper_name: cd?.valueContractPlanning?.shipper_name || '',
            custom_contract_code: cd?.valueContractPlanning?.contract || '',
            custom_publication: cd?.valueContractPlanning?.publication
              ? 'Public'
              : 'Unpublic',
            custom_gas_hour: cd?.valueContractPlanning?.gas_hour, // Gas Hour
            custom_timestamp: cd?.valueContractPlanning?.timestamp, // timestamp
          });
          // console.log('cd : ', cd);
          // console.log('valueContractActual : ', cd?.valueContractActual);
          const contractObjActual = listCustoms(keyHead, {
            ...cd?.valueContractActual,
            // custom_plan_actual: 'Actual (Metering)',
            custom_plan_actual: 'Actual',
            custom_gas_day: cd?.valueContractActual?.gas_day || '',
            custom_shipper_id: shipper || '',
            custom_shipper_name: cd?.valueContractActual?.shipper_name || '',
            custom_contract_code: cd?.valueContractActual?.contract || '',
            custom_publication: cd?.valueContractActual?.publication
              ? 'Public'
              : 'Unpublic',
            custom_gas_hour: cd?.valueContractPlanning?.gas_hour, // Gas Hour
            custom_timestamp: cd?.valueContractPlanning?.timestamp, // timestamp
          });



          return [
            {
              ...contractObjPlanning,
              ["values_"]: cd?.valueContractPlanning
            },
            {
              ...contractObjActual,
              ["values_"]: cd?.valueContractActual
            },
          ];
        });

        const totalShipperPlanningData = listCustoms(keyHead, {
          ...totalShipperPlanning,
          custom_gas_day: totalShipperPlanning?.gas_day || '',
          custom_plan_actual: 'TOTAL PLANNING',
          custom_shipper_id: '',
          custom_shipper_name: '',
          custom_contract_code: '',
          custom_color: 'TOTAL', // #e5f8ff
          custom_publication: '',
          custom_gas_hour: '', // Gas Hour
          custom_timestamp: '', // timestamp
        });
        const totalShipperActualData = listCustoms(keyHead, {
          ...totalShipperActual,
          custom_gas_day: totalShipperActual?.gas_day || '',
          custom_plan_actual: 'TOTAL ACTUAL',
          custom_shipper_id: '',
          custom_shipper_name: '',
          custom_contract_code: '',
          custom_color: 'TOTAL', // #e5f8ff
          custom_publication: '',
          custom_gas_hour: '', // Gas Hour
          custom_timestamp: '', // timestamp
        });

        // ["values_"]: cd?.valueContractPlanning
        const ntotalShipperPlanningData = { ...totalShipperPlanningData, ["values_"]: totalShipperPlanning }
        const ntotalShipperActualData = { ...totalShipperActualData, ["values_"]: totalShipperActual }

        return [
          ...contractData,
          ntotalShipperPlanningData,
          ntotalShipperActualData,
        ];
      });

      const totalAllPlanningData = listCustoms(keyHead, {
        ...totalAllPlanning,
        custom_gas_day: totalAllPlanning?.gas_day || '',
        custom_plan_actual: '',
        custom_shipper_id: '',
        custom_shipper_name: 'NOMINATION',
        custom_contract_code: '',
        custom_color: 'TOTAL ALL', // #fffbec
        custom_gas_hour: '', // Gas Hour
        custom_timestamp: '', // timestamp
      });
      const totalAllActualData = listCustoms(keyHead, {
        ...totalAllActual,
        custom_gas_day: totalAllActual?.gas_day || '',
        custom_plan_actual: '',
        custom_shipper_id: '',
        custom_shipper_name: 'TOTAL',
        custom_contract_code: '',
        custom_color: 'TOTAL ALL', // #fffbec
        custom_gas_hour: '', // Gas Hour
        custom_timestamp: '', // timestamp
      });
      // console.log('totalAllActualData : ', totalAllActualData);
      const ntotalAllPlanningData = { ...totalAllPlanningData, ["values_"]: totalAllPlanning }
      const ntotalAllActualData = { ...totalAllActualData, ["values_"]: totalAllActual }
      return [...totalShipper, ntotalAllPlanningData, ntotalAllActualData];
    });

    // detail_exit_east_ipp

    console.log('newData : ', newData);
    const formateData = await newData.map((e: any) => {
      const setData = {
        ['Publicate']: e['custom_publication'] || '',
        ['Gas Day']: e['custom_gas_day'] || '',
        ['Gas Hour']: e['custom_gas_hour'] || '',
        ['Timestamp']: e['custom_timestamp'] || '',
        ['Summary Pane']: {
          ['Shipper']: e['custom_shipper_name'] || '',
          ['Shipper Name']: e['custom_shipper_name'] || '',
          ['Plan / Actual']: e['custom_plan_actual'] || '',
          ['Contract Code']: e['custom_contract_code'] || '',
          ['Total Entry (MMBTU/D)']: {
            ['East']: e['total_entry_east'] || '',
            ['West']: e['total_entry_west'] || '',
            ['East-West']: e['total_entry_east-west'] || '',
          },
          ['Total Exit (MMBTU/D)']: {
            ['East']: e['total_exit_east'] || '',
            ['West']: e['total_exit_west'] || '',
            ['East-West']: e['total_exit_east-west'] || '',
          },
          ['Imbalance Zone (MMBTU/D)']: {
            ['East']: e['imbZone_east'] || '',
            ['West']: e['imbZone_west'] || '',
            ['Total']: e['imbZone_total'] || '',
          },
          ['Instructed Flow (MMBTU/D)']: {
            ['East']: e['instructedFlow_east'] || '',
            ['West']: e['instructedFlow_west'] || '',
            ['East-West']: e['instructedFlow_east-west'] || '',
          },
          ['Shrinkage Volume (MMBTU/D)']: {
            ['East']: e['shrinkage_east'] || '',
            ['West']: e['shrinkage_west'] || '',
          },
          ['Park (MMBTU/D)']: {
            ['East']: e['park_east'] || '',
            ['West']: e['park_west'] || '',
          },
          ['Unpark (MMBTU/D)']: {
            ['East']: e['Unpark_east'] || '',
            ['West']: e['Unpark_west'] || '',
          },
          ['SOD Park (MMBTU/D)']: {
            ['East']: e['SodPark_east'] || '',
            ['West']: e['SodPark_west'] || '',
          },
          ['EOD Park (MMBTU/D)']: {
            ['East']: e['EodPark_east'] || '',
            ['West']: e['EodPark_west'] || '',
          },
          ['Change Min Inventory (MMBTU/D)']: {
            ['East']: e['minInventoryChange_east'] || '',
            ['West']: e['minInventoryChange_west'] || '',
          },
          ['Reserve Bal. (MMBTU/D)']: {
            ['East']: e['reserveBal_east'] || '',
            ['West']: e['reserveBal_west'] || '',
          },
          ['Adjust Imbalance (MMBTU/D)']: {
            ['East']: e['adjustDailyImb_east'] || '',
            ['West']: e['adjustDailyImb_west'] || '',
          },
          ['Vent Gas']: {
            ['East']: e['ventGas_east'] || '',
            ['West']: e['ventGas_west'] || '',
          },
          ['Commissioning Gas']: {
            ['East']: e['commissioningGas_east'] || '',
            ['West']: e['commissioningGas_west'] || '',
          },
          ['Other Gas']: {
            ['East']: e['otherGas_east'] || '',
            ['West']: e['otherGas_west'] || '',
          },
          ['Daily IMB (MMBTU/D)']: {
            ['East']: e['dailyImb_east'] || '',
            ['West']: e['dailyImb_west'] || '',
          },
          ['AIP (MMBTU/D)']: {
            ['Total']: e['aip'] || '',
          },
          ['AIN (MMBTU/D)']: {
            ['Total']: e['ain'] || '',
          },
          ['%Imb']: {
            ['Total']: e['absimb'] || '',
          },
          ['%Absimb']: {
            ['Total']: e['absimb'] || '',
            // ['Total']: e['custom_abs_absimb'] || '',
          },
          ['Acc. IMB. (MONTH) (MMBTU/D)']: {
            ['East']: e['accImbMonth_east'] || '',
            ['West']: e['accImbMonth_west'] || '',
          },
          ['Acc. IMB. (MMBTU/D)']: {
            ['East']: e['accImb_east'] || '',
            ['West']: e['accImb_west'] || '',
          },
          ['Min. (MMBTU/D)']: {
            ['East']: e['minInventory_east'] || '',
            ['West']: e['minInventory_west'] || '',
          },
        },
        ['Detail Pane']: {
          ['Entry']: {
            ['East']: {
              ['GSP']: e['detail_entry_east_gsp'] || '',
              ['Bypass GSP']: e['detail_entry_east_bypassGas'] || '',
              ['LNG']: e['detail_entry_east_lng'] || '',
              // ['Others']: e['custom_detail_entry_east_'] || '',
              ['Others']: sumDetail(e?.["values_"], 'detail_entry_east_', ['gsp', 'bypassGas', 'lng']),
            },
            ['West']: {
              ['YDN']: e['detail_entry_west_yadana'] || '',
              ['YTG']: e['detail_entry_west_yetagun'] || '',
              ['ZTK']: e['detail_entry_west_zawtika'] || '',
              // ['Others']: e['custom_detail_entry_west_'] || '',
              ['Others']: sumDetail(e?.["values_"], 'detail_entry_west_', ['yadana', 'yetagun', 'zawtika']),
            },
            ['East-West']: {
              ['RA6 East']: e['detail_entry_east-west_ra6East'] || '',
              ['RA6 West']: e['detail_entry_east-west_ra6West'] || '',
              ['BVW10 East']: e['detail_entry_east-west_bvw10East'] || '',
              ['BVW10 West']: e['detail_entry_east-west_bvw10West'] || '',
            },
          },
          ['Exit']: {
            ['East']: {
              ['EGAT']: e['detail_exit_east_egat'] || '',
              ['IPP']: e['detail_exit_east_ipp'] || '',
              // ['Others']: e['custom_detail_exit_east_'] || '',
              ['Others']: sumDetail(e?.["values_"], 'detail_exit_east_', ['egat', 'ipp']),
            },
            ['West']: {
              ['EGAT']: e['detail_exit_west_egat'] || '',
              ['IPP']: e['detail_exit_west_ipp'] || '',
              // ['Others']: e['custom_detail_exit_west_'] || '',
              ['Others']: sumDetail(e?.["values_"], 'detail_exit_west_', ['egat', 'ipp']),
            },
            ['East-West']: {
              ['EGAT']: e['detail_exit_east-west_egat'] || '',
              ['IPP']: e['detail_exit_east-west_ipp'] || '',
              // ['Others']: e['custom_detail_exit_east-west_'] || '',
              ['Others']: sumDetail(e?.["values_"], 'detail_exit_east-west_', ['egat', 'ipp']),
            },
            ['F2&G']: {
              ['East']: e['detail_exit_east_F2andG'] || '',
              ['West']: e['detail_exit_west_F2andG'] || '',
            },
            ['E']: {
              ['East']: e['detail_exit_E_east'] || '',
              ['West']: e['detail_exit_E_west'] || '',
            },
          },
        },
        ['custom_color']: e['custom_color'] || '',
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel
    // console.log('formateData : ', formateData);

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //     "Gas Day",
    //     "Summary Pane.Shipper Name",
    //     "Summary Pane.Contract Code",
    //     "Summary Pane.Total Entry (MMBTU/D).East",
    //     "Summary Pane.Total Entry (MMBTU/D).West",
    //     "Summary Pane.Total Entry (MMBTU/D).East-West",
    //     "Summary Pane.Total Exit (MMBTU/D).East",
    //     "Summary Pane.Total Exit (MMBTU/D).West",
    //     "Summary Pane.Total Exit (MMBTU/D).East-West",
    //     "Summary Pane.Imbalance Zone (MMBTU/D).East",
    //     "Summary Pane.Imbalance Zone (MMBTU/D).West",
    //     "Summary Pane.Imbalance Zone (MMBTU/D).Total",
    //     "Summary Pane.Instructed Flow (MMBTU/D).East",
    //     "Summary Pane.Instructed Flow (MMBTU/D).West",
    //     "Summary Pane.Instructed Flow (MMBTU/D).East-West",
    //     "Summary Pane.Shrinkage Volume (MMBTU/D).East",
    //     "Summary Pane.Shrinkage Volume (MMBTU/D).West",
    //     "Summary Pane.Park (MMBTU/D).East",
    //     "Summary Pane.Park (MMBTU/D).West",
    //     "Summary Pane.Unpark (MMBTU/D).East",
    //     "Summary Pane.Unpark (MMBTU/D).West",
    //     "Summary Pane.SOD Park (MMBTU/D).East",
    //     "Summary Pane.SOD Park (MMBTU/D).West",
    //     "Summary Pane.EOD Park (MMBTU/D).East",
    //     "Summary Pane.EOD Park (MMBTU/D).West",
    //     "Summary Pane.Change Min Inventory (MMBTU/D).East",
    //     "Summary Pane.Change Min Inventory (MMBTU/D).West",
    //     "Summary Pane.Reserve Bal. (MMBTU/D).East",
    //     "Summary Pane.Reserve Bal. (MMBTU/D).West",
    //     "Summary Pane.Adjust Imbalance (MMBTU/D).East",
    //     "Summary Pane.Adjust Imbalance (MMBTU/D).West",
    //     "Summary Pane.Vent Gas.East",
    //     "Summary Pane.Vent Gas.West",
    //     "Summary Pane.Commissioning Gas.East",
    //     "Summary Pane.Commissioning Gas.West",
    //     "Summary Pane.Other Gas.East",
    //     "Summary Pane.Other Gas.West",
    //     "Summary Pane.Daily IMB (MMBTU/D).East",
    //     "Summary Pane.Daily IMB (MMBTU/D).West",
    //     "Summary Pane.AIP (MMBTU/D).Total",
    //     "Summary Pane.AIN (MMBTU/D).Total",
    //     "Summary Pane.%Imb.Total",
    //     "Summary Pane.%Absimb.Total",
    //     "Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).East",
    //     "Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).West",
    //     "Summary Pane.Acc. IMB. (MMBTU/D).East",
    //     "Summary Pane.Acc. IMB. (MMBTU/D).West",
    //     "Summary Pane.Min. (MMBTU/D).East",
    //     "Summary Pane.Min. (MMBTU/D).West",
    //     "Detail Pane.Entry.East.GSP",
    //     "Detail Pane.Entry.East.Bypass GSP",
    //     "Detail Pane.Entry.East.LNG",
    //     "Detail Pane.Entry.East.Others",
    //     "Detail Pane.Entry.West.YDN",
    //     "Detail Pane.Entry.West.YTG",
    //     "Detail Pane.Entry.West.ZTK",
    //     "Detail Pane.Entry.West.Others",
    //     "Detail Pane.Entry.East-West.RA6 East",
    //     "Detail Pane.Entry.East-West.RA6 West",
    //     "Detail Pane.Entry.East-West.BVW10 East",
    //     "Detail Pane.Entry.East-West.BVW10 West",
    //     "Detail Pane.Exit.East.EGAT",
    //     "Detail Pane.Exit.East.IPP",
    //     "Detail Pane.Exit.East.Others",
    //     "Detail Pane.Exit.West.EGAT",
    //     "Detail Pane.Exit.West.IPP",
    //     "Detail Pane.Exit.West.Others",
    //     "Detail Pane.Exit.East-West.EGAT",
    //     "Detail Pane.Exit.East-West.IPP",
    //     "Detail Pane.Exit.East-West.Others",
    //     "Detail Pane.Exit.F2&G.East",
    //     "Detail Pane.Exit.F2&G.West",
    //     "Detail Pane.Exit.E.East",
    //     "Detail Pane.Exit.E.West"
    // ]

    // header color
    const headerColorMap = {
      Publicate: '1573A1', // #1573A1
      'Gas Day': '1573A1', // #1573A1
      'Gas Hour': '1573A1', // #1573A1
      Timestamp: '1573A1', // #1573A1
      'Summary Pane': 'dea477', // #dea477
      'Summary Pane.Shipper Name': '1573A1', // #1573A1
      'Summary Pane.Plan / Actual': '1573A1', // #1573A1
      'Summary Pane.Contract Code': '1573A1', // #1573A1
      'Summary Pane.Total Entry (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Total Entry (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Total Entry (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Total Entry (MMBTU/D).East-West': 'c8ffd7', // #c8ffd7
      'Summary Pane.Total Exit (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Total Exit (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Total Exit (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Total Exit (MMBTU/D).East-West': 'c8ffd7', // #c8ffd7
      'Summary Pane.Imbalance Zone (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Imbalance Zone (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Imbalance Zone (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Imbalance Zone (MMBTU/D).Total': 'f2f2f2', // #f2f2f2
      'Summary Pane.Instructed Flow (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Instructed Flow (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Instructed Flow (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Instructed Flow (MMBTU/D).East-West': 'c8ffd7', // #c8ffd7
      'Summary Pane.Shrinkage Volume (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Shrinkage Volume (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Shrinkage Volume (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Park (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Park (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Park (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Unpark (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Unpark (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Unpark (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.SOD Park (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.SOD Park (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.SOD Park (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.EOD Park (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.EOD Park (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.EOD Park (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Change Min Inventory (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Change Min Inventory (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Change Min Inventory (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Reserve Bal. (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Reserve Bal. (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Reserve Bal. (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Adjust Imbalance (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Adjust Imbalance (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Adjust Imbalance (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Vent Gas': '1573A1', // #1573A1
      'Summary Pane.Vent Gas.East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Vent Gas.West': 'fdcee3', // #fdcee3
      'Summary Pane.Commissioning Gas': '1573A1', // #1573A1
      'Summary Pane.Commissioning Gas.East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Commissioning Gas.West': 'fdcee3', // #fdcee3
      'Summary Pane.Other Gas': '1573A1', // #1573A1
      'Summary Pane.Other Gas.East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Other Gas.West': 'fdcee3', // #fdcee3
      'Summary Pane.Daily IMB (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Daily IMB (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Daily IMB (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.AIP (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.AIP (MMBTU/D).Total': 'e5e5e5', // #e5e5e5
      'Summary Pane.AIN (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.AIN (MMBTU/D).Total': 'e5e5e5', // #e5e5e5
      'Summary Pane.%Imb': '1573A1', // #1573A1
      'Summary Pane.%Imb.Total': 'e5e5e5', // #e5e5e5
      'Summary Pane.%Absimb': '1573A1', // #1573A1
      'Summary Pane.%Absimb.Total': 'e5e5e5', // #e5e5e5
      'Summary Pane.Acc. IMB. (MONTH) (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Acc. IMB. (MONTH) (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Acc. IMB. (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Acc. IMB. (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Acc. IMB. (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Summary Pane.Min. (MMBTU/D)': '1573A1', // #1573A1
      'Summary Pane.Min. (MMBTU/D).East': 'dbe4fe', // #dbe4fe
      'Summary Pane.Min. (MMBTU/D).West': 'fdcee3', // #fdcee3
      'Detail Pane': '6ea48d', // #6ea48d
      'Detail Pane.Entry': '25b9d0', // #25b9d0
      'Detail Pane.Entry.East': 'dbe4fe', // #dbe4fe
      'Detail Pane.Entry.East.GSP': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.East.Bypass GSP': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.East.LNG': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.East.Others': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.West': 'fdcee3', // #fdcee3
      'Detail Pane.Entry.West.YDN': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.West.YTG': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.West.ZTK': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.West.Others': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.East-West': '1573A1', // #c8ffd7
      'Detail Pane.Entry.East-West.RA6 East': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.East-West.RA6 West': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.East-West.BVW10 East': 'e5e5e5', // #e5e5e5
      'Detail Pane.Entry.East-West.BVW10 West': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit': '3a8fb8', // #3a8fb8
      'Detail Pane.Exit.East': 'dbe4fe', // #dbe4fe
      'Detail Pane.Exit.East.EGAT': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.East.IPP': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.East.Others': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.West': 'fdcee3', // #fdcee3
      'Detail Pane.Exit.West.EGAT': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.West.IPP': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.West.Others': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.East-West': 'c8ffd7', // #c8ffd7
      'Detail Pane.Exit.East-West.EGAT': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.East-West.IPP': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.East-West.Others': 'e5e5e5', // #e5e5e5
      'Detail Pane.Exit.F2&G': '1573A1', // #1573A1
      'Detail Pane.Exit.F2&G.East': 'e6eeda', // #e6eeda
      'Detail Pane.Exit.F2&G.West': 'dbe1f2', // #dbe1f2
      'Detail Pane.Exit.E': '1573A1', // #1573A1
      'Detail Pane.Exit.E.East': 'e6eeda', // #e6eeda
      'Detail Pane.Exit.E.West': 'dbe1f2', // #dbe1f2
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (data[i]?.['custom_color'] === 'TOTAL ALL') {
            result[key][i] = 'fffbec'; //#fffbec
          } else if (data[i]?.['custom_color'] === 'TOTAL') {
            result[key][i] = 'e5f8ff'; //#e5f8ff
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Intraday Balancing Report',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  async epMeretingMeteringMeteringChecking(response: Response, payload: any) {
    const { gasDay, filter } = payload || {};
    // console.log('gasDay : ', gasDay);
    // console.log('filter : ', filter);
    const resData = await this.meteringManagementService.meteringChecking({
      gasDay,
    });
    // console.log('resData : ', resData);
    const formateData = await resData.map((e: any) => {
      const cvValue = (pTime: any) => {
        return e[pTime] === 'red_url'
          ? '×'
          : e[pTime] === 'green_url'
            ? '✓'
            : e[pTime] === 'purple_url'
              ? '-'
              : e[pTime] === 'Div/0'
                ? 'Div/0'
                : e[pTime] === '<%low'
                  ? '<%low'
                  : e[pTime] === '>%high'
                    ? '>%high'
                    : 'N/A';
      };

      const setData = {
        ['Gas Day']: dayjs(e["gasDay"], "YYYY-MM-DD").format('DD/MM/YYYY'),
        ['Metering Point ID']: e['meteringPointId'],
        ['Customer Type']: e['customer_type']?.["name"] || "",
        // ['00:00']: e['00:00'] || 'N/A',
        // ['00:00']: { f:`=IMAGE("${e['00:00']}")` },
        ['01:00']: cvValue('type_00:00'),
        ['02:00']: cvValue('type_01:00'),
        ['03:00']: cvValue('type_02:00'),
        ['04:00']: cvValue('type_03:00'),
        ['05:00']: cvValue('type_04:00'),
        ['06:00']: cvValue('type_05:00'),
        ['07:00']: cvValue('type_06:00'),
        ['08:00']: cvValue('type_07:00'),
        ['09:00']: cvValue('type_08:00'),
        ['10:00']: cvValue('type_09:00'),
        ['11:00']: cvValue('type_10:00'),
        ['12:00']: cvValue('type_11:00'),
        ['13:00']: cvValue('type_12:00'),
        ['14:00']: cvValue('type_13:00'),
        ['15:00']: cvValue('type_14:00'),
        ['16:00']: cvValue('type_15:00'),
        ['17:00']: cvValue('type_16:00'),
        ['18:00']: cvValue('type_17:00'),
        ['19:00']: cvValue('type_18:00'),
        ['20:00']: cvValue('type_19:00'),
        ['21:00']: cvValue('type_20:00'),
        ['22:00']: cvValue('type_21:00'),
        ['23:00']: cvValue('type_22:00'),
        ['24:00']: cvValue('type_23:00'),
        // ['24:00']: e['type_24:00'] || 'N/A',
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    // ---------------- manage table excel
    console.log('formateData : ', formateData);

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //     "Gas Day",
    //     "Metering Point ID",
    //     "00:00",
    //     "01:00",
    //     "02:00",
    //     "03:00",
    //     "04:00",
    //     "05:00",
    //     "06:00",
    //     "07:00",
    //     "08:00",
    //     "09:00",
    //     "10:00",
    //     "11:00",
    //     "12:00",
    //     "13:00",
    //     "14:00",
    //     "15:00",
    //     "16:00",
    //     "17:00",
    //     "18:00",
    //     "19:00",
    //     "20:00",
    //     "21:00",
    //     "22:00",
    //     "23:00",
    //     "24:00"
    // ]

    // header color
    const headerColorMap = {
      'Gas Day': '1573A1', // #1573A1
      'Metering Point ID': '1573A1', // #1573A1
      'Customer Type': '1573A1', // #1573A1
      '00:00': '1573A1', // #1573A1
      '01:00': '1573A1', // #1573A1
      '02:00': '1573A1', // #1573A1
      '03:00': '1573A1', // #1573A1
      '04:00': '1573A1', // #1573A1
      '05:00': '1573A1', // #1573A1
      '06:00': '1573A1', // #1573A1
      '07:00': '1573A1', // #1573A1
      '08:00': '1573A1', // #1573A1
      '09:00': '1573A1', // #1573A1
      '10:00': '1573A1', // #1573A1
      '11:00': '1573A1', // #1573A1
      '12:00': '1573A1', // #1573A1
      '13:00': '1573A1', // #1573A1
      '14:00': '1573A1', // #1573A1
      '15:00': '1573A1', // #1573A1
      '16:00': '1573A1', // #1573A1
      '17:00': '1573A1', // #1573A1
      '18:00': '1573A1', // #1573A1
      '19:00': '1573A1', // #1573A1
      '20:00': '1573A1', // #1573A1
      '21:00': '1573A1', // #1573A1
      '22:00': '1573A1', // #1573A1
      '23:00': '1573A1', // #1573A1
      '24:00': '1573A1', // #1573A1
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      const colorMap = {
        '×': { bg: 'ffafa9ff', font: 'ffafa9ff' }, //red_url #ffafa9ff
        '✓': { bg: '72ff85ff', font: '72ff85ff' }, //green_url #72ff85ff
        '-': { bg: 'c58affff', font: 'c58affff' }, //purple_url #c58affff
        'N/A': { bg: 'f4f4f4', font: 'f4f4f4' }, //gray_url #f4f4f4
        'Div/0': { bg: 'ff5d5dff', font: 'ff5d5dff' }, // #ff5d5dff
        '<%low': { bg: '4cb7ffff', font: '4cb7ffff' }, // #4cb7ffff
        '>%high': { bg: 'ffcb5bff', font: 'ffcb5bff' }, // #ffcb5bff
      };

      const hours = [];
      for (let h = 0; h < 24; h++) {
        hours.push(h.toString().padStart(2, '0') + ':00');
      }

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {

          for (const hour of hours) {
            const cellValue = data[i]?.[hour];
            if (cellValue && colorMap[cellValue] && key === hour) {
              result[key][i] = colorMap[cellValue].bg;
            }
          }
        }
      }

      return result;
    }

    const nformateData = formateData?.map((e: any) => {
      const { ['16:00']: val16, ...nE } = e;
      // red_url
      // green_url
      // purple_url
      // gray_url

      return {
        ...nE,
      };
    });

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Metering Metering Checking',
      true,
      headerColorMap,
      cellHighlightMap,
    );

    // await this.exportDataToExcelNew(
    //   formateData,
    //   response,
    //   'Metering Metering Checking',
    //   true,
    // );
  }

  async epAllocationAllocationManagement(response: Response, payload: any) {
    const { bodys, filter } = payload || {};
    console.log('bodys : ', bodys);

    // bodys?.idAr
    const resData = await this.allocationService.allcationOnceId(bodys, null);
    console.log('resData : ', resData);

    // green
    const renderStatus: any = (data: any) => {
      // console.log('data', data)

      const items: any = [
        {
          id: 0,
          label: 'Shipper Reviewed',
          color: '#D0E5FD',
        },
        {
          id: 1,
          label: 'Rejected',
          color: '#FFF1CE',
        },
        {
          id: 2,
          label: 'Accepted',
          color: '#C8FFD7',
        },
        {
          id: 3,
          label: 'Allocated',
          color: '#A7EFFF',
        },
        {
          id: 4,
          label: 'Not Review',
          color: '#DEDEDE',
        },
      ];

      const m11: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 2,
      ); //shipper
      const m13: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 3,
      ); //accepted
      const m14: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 4,
      ); //allowcated
      const m12: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 5,
      ); //rejected

      const renderColor: any =
        m11?.length > 0
          ? items[0]?.color
          : m12?.length > 0
            ? items[1]?.color
            : m13?.length > 0
              ? items[2]?.color
              : m14?.length > 0
                ? items[3]?.color
                : items[4]?.color;
      const renderTxt: any =
        m11?.length > 0
          ? items[0]?.label
          : m12?.length > 0
            ? items[1]?.label
            : m13?.length > 0
              ? items[2]?.label
              : m14?.length > 0
                ? items[3]?.label
                : items[4]?.label;

      // return (<div className="w-[160px] p-1 text-center rounded-[50px]" style={{ background: renderColor }}>{renderTxt}</div>)
      // return { renderTxt, renderColor };
      return renderTxt;
    };

    const priorityMap: any = {
      2: 1, // Highest priority
      5: 2,
      3: 3,
      4: 4,
      1: 5, // Lowest priority
    };

    const generateRandomId = () =>
    (typeof crypto !== 'undefined' && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : require('crypto').randomUUID());

    const groupDataAlloManage = (data: any[]) => {
      const grouped: any = data.reduce(
        (acc, item) => {
          const key = `${item.gas_day}-${item.point}`;

          if (!acc[key]) {
            acc[key] = {
              id: generateRandomId(),
              gas_day: item.gas_day,
              point_text: item?.point,
              entry_exit: item?.entry_exit_obj?.name,

              nomination_value: 0,
              system_allocation: 0,
              intraday_system: 0,
              previous_allocation_tpa_for_review: 0,
              shipper_allocation_review: 0,
              metering_value: 0,

              data: [],
              priorityStatus: item?.allocation_status?.id ?? 999,
            };
          }

          acc[key].data.push(item);

          // Sum
          acc[key].nomination_value += Number(item?.nominationValue ?? 0);
          acc[key].system_allocation += Number(item?.systemAllocation ?? 0);
          acc[key].intraday_system += Number(item?.intradaySystem ?? 0);
          acc[key].previous_allocation_tpa_for_review += Number(
            item?.previousAllocationTPAforReview ?? 0,
          );
          acc[key].metering_value += Number(item?.meteringValue ?? 0);

          const shipperReview =
            item?.allocation_management_shipper_review?.[0]
              ?.shipper_allocation_review ??
            item?.shipperAllocationReview ??
            0;
          acc[key].shipper_allocation_review += Number(shipperReview);

          // Update priority status if item has higher priority
          const currentPriority = priorityMap[acc[key].priorityStatus] ?? 999;
          const itemPriority = priorityMap[item.allocation_status?.id] ?? 999;

          if (itemPriority < currentPriority) {
            acc[key].priorityStatus = item.allocation_status?.id;
          }

          return acc;
        },
        {} as Record<string, any>,
      );

      return Object.values(grouped).map(
        ({ priorityStatus, ...rest }: any) => rest,
      );
    };

    const nresData = groupDataAlloManage(resData);
    console.log('nresData : ', nresData);

    const newNResData = nresData?.flatMap((e: any) => {
      //
      const rowData = e['data']?.map((r: any) => {
        const lengthSubmission =
          (r['allocation_management_comment'].length > 0 &&
            r['allocation_management_comment']
              .map(
                (allocation_management_comment: any) =>
                  `${allocation_management_comment?.remark}`,
              )
              .join(',')) ||
          '';

        return {
          ['Total']: '',
          ['Status']: r['allocation_status']?.['name'] || '',
          ['Gas Day']:
            (r['gas_day'] && getTodayNow(r['gas_day']).format('DD/MM/YYYY')) ||
            '',
          ['Shipper Name']: r['group']?.['name'], // ""
          ['Contract Code']: r['contract'] || '', // ""
          ['Nomination Point /Concept Point']: r['point'] || '',
          ['Entry / Exit']: r['entry_exit'] || '',
          ['Nominated Value (MMBTU/D)']: r['nominationValue'] !== null && this.dcimal4(parseToNumber(r['nominationValue'])) || null, // value ""
          ['System Allocation (MMBTU/D)']: r['systemAllocation'] !== null && this.dcimal4(parseToNumber(r['systemAllocation'])) || null,
          ['Intraday System Allocation']: r['intradaySystem'] !== null && this.dcimal4(parseToNumber(r['intradaySystem'])) || null,
          ['Previous Allocation TPA for Review (MMBTU/D)']: r['previousAllocationTPAforReview'] !== null && this.dcimal4(parseToNumber(
            r['previousAllocationTPAforReview'])
          ) || null,
          ['Shipper Review Allocation (MMBTU/D)']:
            r['allocation_management_shipper_review']?.length > 0
              ? this.dcimal4(
                parseToNumber(r['allocation_management_shipper_review'][0]
                  ?.shipper_allocation_review),
              )
              : '',
          ['Metering Value (MMBTU/D)_temp']: r['meteringValue'] !== null && this.dcimal4(parseToNumber(r['meteringValue'])) || null,
          ['Metering Value (MMBTU/D)']: "",
          ['Review Code']: r['review_code'] || '', // ""
          ['Comment']:
            lengthSubmission.length > 32767
              ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
              : lengthSubmission, // ""
          ['tab']: '',
        };
      });

      // green
      const setDataObjGreen = {
        ['Total']: 'Total',
        ['Status']: renderStatus(e['data']),
        ['Gas Day']:
          (e['gas_day'] && getTodayNow(e['gas_day']).format('DD/MM/YYYY')) ||
          '',
        ['Shipper Name']: '', // ""
        ['Contract Code']: '', // ""
        ['Nomination Point /Concept Point']: e['point_text'] || '',
        ['Entry / Exit']: e['entry_exit'] || '',
        ['Nominated Value (MMBTU/D)']: this.dcimal4(rowData?.reduce((accumulator, currentValue) => accumulator + parseToNumber(currentValue['Nominated Value (MMBTU/D)'] ?? 0), 0,)), // ""
        ['System Allocation (MMBTU/D)']: this.dcimal4(rowData?.reduce((accumulator, currentValue) => accumulator + parseToNumber(currentValue['System Allocation (MMBTU/D)'] ?? 0), 0,)),
        ['Intraday System Allocation']: this.dcimal4(rowData?.reduce((accumulator, currentValue) => accumulator + parseToNumber(currentValue['Intraday System Allocation'] ?? 0), 0,)),
        ['Previous Allocation TPA for Review (MMBTU/D)']: this.dcimal4(rowData?.reduce((accumulator, currentValue) => accumulator + parseToNumber(currentValue['Previous Allocation TPA for Review (MMBTU/D)'] ?? 0), 0,)),
        ['Shipper Review Allocation (MMBTU/D)']: this.dcimal4(rowData?.reduce((accumulator, currentValue) => accumulator + parseToNumber(currentValue['Shipper Review Allocation (MMBTU/D)'] ?? 0), 0,)),
        ['Metering Value (MMBTU/D)']: rowData?.[0]?.['Metering Value (MMBTU/D)_temp'] !== null && this.dcimal4(parseToNumber(rowData?.[0]?.['Metering Value (MMBTU/D)_temp'])) || null,
        ['Review Code']: '', // ""
        ['Comment']: '', // ""
        ['tab']: 'green',
      };

      return [...[setDataObjGreen], ...rowData];
    });

    console.log('newNResData : ', newNResData);

    // const fId = resData?.filter((f: any) => bodys?.idAr?.includes(f?.id));

    const formateData = await newNResData.map((e: any) => {
      const setData = {
        ['Total']: e['Total'],
        ['Status']: e['Status'],
        ['Gas Day']: e['Gas Day'],
        ['Shipper Name']: e['Shipper Name'],
        ['Contract Code']: e['Contract Code'],
        ['Nomination Point /Concept Point']:
          e['Nomination Point /Concept Point'],
        ['Entry / Exit']: e['Entry / Exit'],
        ['Nominated Value (MMBTU/D)']: e['Nominated Value (MMBTU/D)'],
        ['System Allocation (MMBTU/D)']: e['System Allocation (MMBTU/D)'],
        ['Intraday System Allocation']: e['Intraday System Allocation'],
        ['Previous Allocation TPA for Review (MMBTU/D)']:
          e['Previous Allocation TPA for Review (MMBTU/D)'],
        ['Shipper Review Allocation (MMBTU/D)']:
          e['Shipper Review Allocation (MMBTU/D)'],
        ['Metering Value (MMBTU/D)']: e['Metering Value (MMBTU/D)'],
        ['Review Code']: e['Review Code'],
        ['Comment']: e['Comment'],
        ['tab']: e['tab'],
      };
      const filteredData = Object.keys(setData)
        // .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    // ---------------- manage table excel
    console.log('formateData : ', formateData);

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //     "Total",
    //     "Status",
    //     "Gas Day",
    //     "Shipper Name",
    //     "Contract Code",
    //     "Nomination Point /Concept Point",
    //     "Entry / Exit",
    //     "Nominated Value (MMBTU/D)",
    //     "System Allocation (MMBTU/D)",
    //     "Intraday System Allocation",
    //     "Previous Allocation TPA for Review (MMBTU/D)",
    //     "Shipper Allocation Review (MMBTU/D)",
    //     "Metering Value (MMBTU/D)",
    //     "Review Code",
    //     "Comment"
    // ]

    // header color

    const headerColorMap = {
      Total: '1573A1', // #1573A1
      Status: '1573A1', // #1573A1
      'Gas Day': '1573A1', // #1573A1
      'Shipper Name': '1573A1', // #1573A1
      'Contract Code': '1573A1', // #1573A1
      'Nomination Point /Concept Point': '1573A1', // #1573A1
      'Entry / Exit': '1573A1', // #1573A1
      'Nominated Value (MMBTU/D)': '1573A1', // #1573A1
      'System Allocation (MMBTU/D)': '1573A1', // #1573A1
      'Intraday System Allocation': '1573A1', // #1573A1
      'Previous Allocation TPA for Review (MMBTU/D)': 'b8e6ff', // #b8e6ff
      'Shipper Allocation Review (MMBTU/D)': 'b8e6ff', // #b8e6ff
      'Metering Value (MMBTU/D)': 'b8e6ff', // #b8e6ff
      'Review Code': 'b8e6ff', // #b8e6ff
      Comment: 'b8e6ff', // #b8e6ff
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (data[i]?.['tab'] === 'green') {
            result[key][i] = 'e8ffee'; //#e8ffee
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Allocation Management',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  // --------

  // ref epAllocationAllocationManagement
  async epAllocationAllocationManagementSentEmailOnly(
    response: Response,
    payload: any,
    userId?: any,
    resData?: any,
    userType?: any,
    shipperId?: any,
  ) {
    const { bodys, filter } = payload || {};
    console.log('bodys : ', bodys);
    console.log('userId : ', userId);
    console.log('userType : ', userType);
    console.log('shipperId : ', shipperId);

    // bodys?.idAr

    // green
    const renderStatus: any = (data: any) => {
      // console.log('data', data)

      const items: any = [
        {
          id: 0,
          label: 'Shipper Reviewed',
          color: '#D0E5FD',
        },
        {
          id: 1,
          label: 'Rejected',
          color: '#FFF1CE',
        },
        {
          id: 2,
          label: 'Accepted',
          color: '#C8FFD7',
        },
        {
          id: 3,
          label: 'Allocated',
          color: '#A7EFFF',
        },
        {
          id: 4,
          label: 'Not Review',
          color: '#DEDEDE',
        },
      ];

      const m11: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 2,
      ); //shipper
      const m13: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 3,
      ); //accepted
      const m14: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 4,
      ); //allowcated
      const m12: any = data?.filter(
        (item: any) => item?.allocation_status?.id == 5,
      ); //rejected

      const renderColor: any =
        m11?.length > 0
          ? items[0]?.color
          : m12?.length > 0
            ? items[1]?.color
            : m13?.length > 0
              ? items[2]?.color
              : m14?.length > 0
                ? items[3]?.color
                : items[4]?.color;
      const renderTxt: any =
        m11?.length > 0
          ? items[0]?.label
          : m12?.length > 0
            ? items[1]?.label
            : m13?.length > 0
              ? items[2]?.label
              : m14?.length > 0
                ? items[3]?.label
                : items[4]?.label;

      // return (<div className="w-[160px] p-1 text-center rounded-[50px]" style={{ background: renderColor }}>{renderTxt}</div>)
      // return { renderTxt, renderColor };
      return renderTxt;
    };

    const priorityMap: any = {
      2: 1, // Highest priority
      5: 2,
      3: 3,
      4: 4,
      1: 5, // Lowest priority
    };

    const generateRandomId = () =>
    (typeof crypto !== 'undefined' && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : require('crypto').randomUUID());

    const groupDataAlloManage = (data: any[]) => {
      const grouped: any = data.reduce(
        (acc, item) => {
          const key = `${item.gas_day}-${item.point}`;

          if (!acc[key]) {
            acc[key] = {
              id: generateRandomId(),
              gas_day: item.gas_day,
              point_text: item?.point,
              entry_exit: item?.entry_exit_obj?.name,

              nomination_value: 0,
              system_allocation: 0,
              intraday_system: 0,
              previous_allocation_tpa_for_review: 0,
              shipper_allocation_review: 0,
              metering_value: 0,

              data: [],
              priorityStatus: item?.allocation_status?.id ?? 999,
            };
          }

          acc[key].data.push(item);

          // Sum
          acc[key].nomination_value += Number(item?.nominationValue ?? 0);
          acc[key].system_allocation += Number(item?.systemAllocation ?? 0);
          acc[key].intraday_system += Number(item?.intradaySystem ?? 0);
          acc[key].previous_allocation_tpa_for_review += Number(
            item?.previousAllocationTPAforReview ?? 0,
          );
          acc[key].metering_value += Number(item?.meteringValue ?? 0);

          const shipperReview =
            item?.allocation_management_shipper_review?.[0]
              ?.shipper_allocation_review ??
            item?.shipperAllocationReview ??
            0;
          acc[key].shipper_allocation_review += Number(shipperReview);

          // Update priority status if item has higher priority
          const currentPriority = priorityMap[acc[key].priorityStatus] ?? 999;
          const itemPriority = priorityMap[item.allocation_status?.id] ?? 999;

          if (itemPriority < currentPriority) {
            acc[key].priorityStatus = item.allocation_status?.id;
          }

          return acc;
        },
        {} as Record<string, any>,
      );

      return Object.values(grouped).map(
        ({ priorityStatus, ...rest }: any) => rest,
      );
    };

    const nresData = groupDataAlloManage(resData);
    console.log('nresData : ', nresData);

    const diffDataFN = (dData: any, userType: any) => {
      if (userType === 3) {
        // กรอง สีขาว ไมเอาสีเขียว รายการที่ Diff ระหว่าง Shipper Allocation Review และ System Allocation
        // ทำมาแล้วจาก allocationManagementSendEmail
        return dData;
      } else {
        // กรอง เฉพาะสีเขียว รายการที่ Diff ระหว่าง Shipper Allocation Review และ System Allocation
        const diffGreen = dData?.filter((f: any) => {
          return f?.shipper_allocation_review !== f?.system_allocation;
        });
        return diffGreen;
      }
    };

    const diffData = diffDataFN(nresData, userType);
    console.log('diffData : ', diffData);

    const newNResData = diffData?.flatMap((e: any) => {
      //
      const rowData = e['data']?.map((r: any) => {
        const lengthSubmission =
          (r['allocation_management_comment'].length > 0 &&
            r['allocation_management_comment']
              .map(
                (allocation_management_comment: any) =>
                  `${allocation_management_comment?.remark}`,
              )
              .join(',')) ||
          '';

        return {
          ['Total']: '',
          ['Status']: r['allocation_status']?.['name'] || '',
          ['Gas Day']:
            (r['gas_day'] && getTodayNow(r['gas_day']).format('DD/MM/YYYY')) ||
            '',
          ['Shipper Name']: r['group']?.['name'], // ""
          ['Contract Code']: r['contract'] || '', // ""
          ['Nomination Point /Concept Point']: r['point'] || '',
          ['Entry / Exit']: r['entry_exit'] || '',
          ['Nominated Value (MMBTU/D)']: this.dcimal4(r['nominationValue']), // value ""
          ['System Allocation (MMBTU/D)']: this.dcimal4(r['systemAllocation']),
          ['Intraday System Allocation']: this.dcimal4(r['intradaySystem']),
          ['Previous Allocation TPA for Review (MMBTU/D)']: this.dcimal4(
            r['previousAllocationTPAforReview'],
          ),
          ['Shipper Review Allocation (MMBTU/D)']:
            r['allocation_management_shipper_review']?.length > 0
              ? this.dcimal4(
                r['allocation_management_shipper_review'][0]
                  ?.shipper_allocation_review,
              )
              : '',
          ['Metering Value (MMBTU/D)']: this.dcimal4(r['meteringValue']),
          ['Review Code']: r['review_code'] || '', // ""
          ['Comment']:
            lengthSubmission.length > 32767
              ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
              : lengthSubmission, // ""
          ['tab']: '',
          ['_meterName']: r['meterName'], //['LMPT1_1', 'LMPT1_2']
          ['_point']: r['point'], //LMPT1
        };
      });

      // green
      const setDataObjGreen = {
        ['Total']: 'Total',
        ['Status']: renderStatus(e['data']),
        ['Gas Day']:
          (e['gas_day'] && getTodayNow(e['gas_day']).format('DD/MM/YYYY')) ||
          '',
        ['Shipper Name']: '', // ""
        ['Contract Code']: '', // ""
        ['Nomination Point /Concept Point']: e['point_text'] || '',
        ['Entry / Exit']: e['entry_exit'] || '',
        ['Nominated Value (MMBTU/D)']: e['nominationValue'] || '', // ""
        ['System Allocation (MMBTU/D)']: this.dcimal4(e['system_allocation']),
        ['Intraday System Allocation']: this.dcimal4(e['intraday_system']),
        ['Previous Allocation TPA for Review (MMBTU/D)']: this.dcimal4(
          e['previous_allocation_tpa_for_review'],
        ),
        ['Shipper Review Allocation (MMBTU/D)']: this.dcimal4(
          e['shipper_allocation_review'],
        ),
        ['Metering Value (MMBTU/D)']: '',
        ['Review Code']: '', // ""
        ['Comment']: '', // ""
        ['tab']: 'green',
        ['_meterName']: '', //['LMPT1_1', 'LMPT1_2']
        ['_point']: '', //LMPT1
      };

      if (userType === 3) {
        return [...rowData];
      } else {
        return [...[setDataObjGreen], ...rowData];
      }
    });

    const formateData = await newNResData.map((e: any) => {
      const setData = {
        ['Total']: e['Total'],
        ['Status']: e['Status'],
        ['Gas Day']: e['Gas Day'],
        ['Shipper Name']: e['Shipper Name'],
        ['Contract Code']: e['Contract Code'],
        ['Nomination Point /Concept Point']:
          e['Nomination Point /Concept Point'],
        ['Entry / Exit']: e['Entry / Exit'],
        ['Nominated Value (MMBTU/D)']: e['Nominated Value (MMBTU/D)'],
        ['System Allocation (MMBTU/D)']: e['System Allocation (MMBTU/D)'],
        ['Intraday System Allocation']: e['Intraday System Allocation'],
        ['Previous Allocation TPA for Review (MMBTU/D)']:
          e['Previous Allocation TPA for Review (MMBTU/D)'],
        ['Shipper Review Allocation (MMBTU/D)']:
          e['Shipper Review Allocation (MMBTU/D)'],
        ['Metering Value (MMBTU/D)']: e['Metering Value (MMBTU/D)'],
        ['Review Code']: e['Review Code'],
        ['Comment']: e['Comment'],
        ['tab']: e['tab'],
        ['_meterName']: e['_meterName'], //['LMPT1_1', 'LMPT1_2']
        ['_point']: e['_point'], //LMPT1
      };
      const filteredData = Object.keys(setData)
        // .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    // console.log('formateData : ', formateData);
    // ---------------- manage table excel
    // sheet 1
    const filterHeader = filter || [];
    // const filterHeader = [
    //     "Total",
    //     "Status",
    //     "Gas Day",
    //     "Shipper Name",
    //     "Contract Code",
    //     "Nomination Point /Concept Point",
    //     "Entry / Exit",
    //     "Nominated Value (MMBTU/D)",
    //     "System Allocation (MMBTU/D)",
    //     "Intraday System Allocation",
    //     "Previous Allocation TPA for Review (MMBTU/D)",
    //     "Shipper Allocation Review (MMBTU/D)",
    //     "Metering Value (MMBTU/D)",
    //     "Review Code",
    //     "Comment"
    // ]

    // header color

    const headerColorMap = {
      Total: '1573A1', // #1573A1
      Status: '1573A1', // #1573A1
      'Gas Day': '1573A1', // #1573A1
      'Shipper Name': '1573A1', // #1573A1
      'Contract Code': '1573A1', // #1573A1
      'Nomination Point /Concept Point': '1573A1', // #1573A1
      'Entry / Exit': '1573A1', // #1573A1
      'Nominated Value (MMBTU/D)': '1573A1', // #1573A1
      'System Allocation (MMBTU/D)': '1573A1', // #1573A1
      'Intraday System Allocation': '1573A1', // #1573A1
      'Previous Allocation TPA for Review (MMBTU/D)': 'b8e6ff', // #b8e6ff
      'Shipper Allocation Review (MMBTU/D)': 'b8e6ff', // #b8e6ff
      'Metering Value (MMBTU/D)': 'b8e6ff', // #b8e6ff
      'Review Code': 'b8e6ff', // #b8e6ff
      Comment: 'b8e6ff', // #b8e6ff
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (data[i]?.['tab'] === 'green') {
            result[key][i] = 'e8ffee'; //#e8ffee
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );

    const result = this.filterNestedData(formateData, filterHeader);

    // console.log('- formateData : ', formateData);
    const meterData = [];

    for (let i = 0; i < formateData.length; i++) {
      if (formateData[i]?.['_meterName'].length > 0) {
        for (
          let iMeter = 0;
          iMeter < formateData[i]?.['_meterName'].length;
          iMeter++
        ) {
          meterData.push({
            'Gas Day': formateData[i]?.['Gas Day'],
            'Nomination Point': formateData[i]?.['_point'],
            'Metering Point': formateData[i]?.['_meterName'][iMeter],
            'Metering Value': formateData[i]?.['Metering Value (MMBTU/D)'],
          });
        }
      }
    }
    // sheet 2
    const dataSheet2 = meterData;
    const filterHeaderSheet2 = [
      'Gas Day',
      'Nomination Point',
      'Metering Point',
      'Metering Value',
    ];

    const headerColorMapSheet2 = {
      'Gas Day': '1573A1', // #1573A1
      'Nomination Point': '1573A1', // #1573A1
      'Metering Point': '1573A1', // #1573A1
      'Metering Value': 'b8e6ff', // #b8e6ff
    };

    function generateCellHighlightMapMultipleSheet2(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          // no
        }
      }

      return result;
    }

    const cellHighlightMapSheet2 = generateCellHighlightMapMultipleSheet2(
      filterHeaderSheet2,
      dataSheet2,
      'EAF5F8',
    );
    const resultSheet2 = this.filterNestedData(dataSheet2, filterHeaderSheet2);

    // end

    return await this.exportDataToExcelWithMultiLevelHeaderNewMultiSheet(
      [
        {
          data: result,
          response,
          nameSheet: 'Allocation Management',
          skipFirstRow: true,
          headerColorMap,
          cellHighlightMap,
        }, // sheet 1
        {
          data: resultSheet2,
          response,
          nameSheet: 'Metering Data',
          skipFirstRow: true,
          headerColorMap: headerColorMapSheet2,
          cellHighlightMap: cellHighlightMapSheet2,
        }, // sheet 2
      ],
      'Allocation Management',
      response,
    );
  }

  async intradayAccImbalanceDashboard(
    response: Response,
    payload: any,
    userId: any,
  ) {
    // const userId = 99999
    const { bodys, filter } = payload || {};
    // const resData: any =
    //   await this.balancingService.intradayAccImbalanceDashboard(bodys, userId);
    const resData: any =
      await this.balancingService.intradayAccImbalanceDashboard2(bodys, userId);

    // const groupMasterCheck = await this.prisma.group.findFirst({
    //   where: {
    //     account_manage: {
    //       some: {
    //         account_id: Number(userId),
    //       },
    //     },
    //   },
    // });

    // const shipperIdName = groupMasterCheck?.id_name;
    // const userType = groupMasterCheck?.user_type_id;

    const valueDigitKeyPure = (hourData: any, pE: any, nKey: any) => {
      const resultKey =
        hourData?.find((f: any) => f?.gas_hour_text === pE)?.value?.[nKey] !==
          undefined &&
          hourData?.find((f: any) => f?.gas_hour_text === pE)?.value?.[nKey] !==
          null
          ? this.dcimal4(
            hourData?.find((f: any) => f?.gas_hour_text === pE)?.value?.[
            nKey
            ],
          )
          : null;

      return resultKey;
    };

    // previous_date always have at least 1 data that is gas_day
    const previousDate = bodys?.previous_date ?? (bodys?.gas_day ? [bodys.gas_day] : [])
    const onlyPreviousDateData = resData?.data?.filter((f: any) => previousDate.includes(f?.gas_day)) ?? []
    const nresData = []
    for (let i = 0; i < onlyPreviousDateData.length; i++) {
      const nowData = resData?.data[i] || [];
      const hourData = nowData?.hour;
      const dataOfEachDate = resData?.templateLabelKeys?.map((e: any) => {

        // const valueDigitKeyTag = (pE: any, nKey: any) => {
        //   const baseValue = pE?.[nKey];
        //   const resultKey =
        //     baseValue !== undefined && baseValue !== null
        //       ? this.dcimal4(baseValue)
        //       : null;

        //   return resultKey;
        // };

        // gas_hour_text

        return {
          Info: e?.lebel || '',
          'Date': nowData?.gas_day || '',
          // '00:00': valueDigitKeyPure(hourData, '00:00', e?.key),
          '01:00': valueDigitKeyPure(hourData, '01:00', e?.key),
          '02:00': valueDigitKeyPure(hourData, '02:00', e?.key),
          '03:00': valueDigitKeyPure(hourData, '03:00', e?.key),
          '04:00': valueDigitKeyPure(hourData, '04:00', e?.key),
          '05:00': valueDigitKeyPure(hourData, '05:00', e?.key),
          '06:00': valueDigitKeyPure(hourData, '06:00', e?.key),
          '07:00': valueDigitKeyPure(hourData, '07:00', e?.key),
          '08:00': valueDigitKeyPure(hourData, '08:00', e?.key),
          '09:00': valueDigitKeyPure(hourData, '09:00', e?.key),
          '10:00': valueDigitKeyPure(hourData, '10:00', e?.key),
          '11:00': valueDigitKeyPure(hourData, '11:00', e?.key),
          '12:00': valueDigitKeyPure(hourData, '12:00', e?.key),
          '13:00': valueDigitKeyPure(hourData, '13:00', e?.key),
          '14:00': valueDigitKeyPure(hourData, '14:00', e?.key),
          '15:00': valueDigitKeyPure(hourData, '15:00', e?.key),
          '16:00': valueDigitKeyPure(hourData, '16:00', e?.key),
          '17:00': valueDigitKeyPure(hourData, '17:00', e?.key),
          '18:00': valueDigitKeyPure(hourData, '18:00', e?.key),
          '19:00': valueDigitKeyPure(hourData, '19:00', e?.key),
          '20:00': valueDigitKeyPure(hourData, '20:00', e?.key),
          '21:00': valueDigitKeyPure(hourData, '21:00', e?.key),
          '22:00': valueDigitKeyPure(hourData, '22:00', e?.key),
          '23:00': valueDigitKeyPure(hourData, '23:00', e?.key),
          '00:00': valueDigitKeyPure(hourData, '24:00', e?.key)
        };
      }) ?? [];

      nresData.push(...dataOfEachDate)
    }

    // console.log('--nresData : ', nresData);
    const formateData = nresData
      .sort((a: any, b: any) => dayjs(a?.['Date'], "YYYY-MM-DD").valueOf() - dayjs(b?.['Date'], "YYYY-MM-DD").valueOf())
      .map((e: any) => {
        const setData = {
          Info: e?.['Info'],
          'Date': dayjs(e?.['Date'], "YYYY-MM-DD").format("DD/MM/YYYY"),
          '01:00': e?.['01:00'],
          '02:00': e?.['02:00'],
          '03:00': e?.['03:00'],
          '04:00': e?.['04:00'],
          '05:00': e?.['05:00'],
          '06:00': e?.['06:00'],
          '07:00': e?.['07:00'],
          '08:00': e?.['08:00'],
          '09:00': e?.['09:00'],
          '10:00': e?.['10:00'],
          '11:00': e?.['11:00'],
          '12:00': e?.['12:00'],
          '13:00': e?.['13:00'],
          '14:00': e?.['14:00'],
          '15:00': e?.['15:00'],
          '16:00': e?.['16:00'],
          '17:00': e?.['17:00'],
          '18:00': e?.['18:00'],
          '19:00': e?.['19:00'],
          '20:00': e?.['20:00'],
          '21:00': e?.['21:00'],
          '22:00': e?.['22:00'],
          '23:00': e?.['23:00'],
          '00:00': e?.['00:00'],
        };
        const filteredData = Object.keys(setData).reduce((obj, key) => {
          obj[key] = setData[key];
          return obj;
        }, {});

        //

        return filteredData;
      });

    // ---------------- manage table excel
    console.log('formateData : ', formateData);

    // sort header
    const filterHeader = filter || [];
    // Replace "24:00" with "00:00" in the filter header
    const index = filterHeader.indexOf("24:00");
    if (index !== -1) {
      filterHeader[index] = "00:00";
    }
    // const filterHeader = [
    //     "Info",
    //     "00:00",
    //     "01:00",
    //     "02:00",
    //     "03:00",
    //     "04:00",
    //     "05:00",
    //     "06:00",
    //     "07:00",
    //     "08:00",
    //     "09:00",
    //     "10:00",
    //     "11:00",
    //     "12:00",
    //     "13:00",
    //     "14:00",
    //     "15:00",
    //     "16:00",
    //     "17:00",
    //     "18:00",
    //     "19:00",
    //     "20:00",
    //     "21:00",
    //     "22:00",
    //     "23:00",
    //     "24:00",
    // ]

    // header color
    const headerColorMap = {
      Info: '1573A1', // #1573A1
      'Date': '1573A1', // #1573A1
      '00:00': '1573A1', // #1573A1
      '01:00': '1573A1', // #1573A1
      '02:00': '1573A1', // #1573A1
      '03:00': '1573A1', // #1573A1
      '04:00': '1573A1', // #1573A1
      '05:00': '1573A1', // #1573A1
      '06:00': '1573A1', // #1573A1
      '07:00': '1573A1', // #1573A1
      '08:00': '1573A1', // #1573A1
      '09:00': '1573A1', // #1573A1
      '10:00': '1573A1', // #1573A1
      '11:00': '1573A1', // #1573A1
      '12:00': '1573A1', // #1573A1
      '13:00': '1573A1', // #1573A1
      '14:00': '1573A1', // #1573A1
      '15:00': '1573A1', // #1573A1
      '16:00': '1573A1', // #1573A1
      '17:00': '1573A1', // #1573A1
      '18:00': '1573A1', // #1573A1
      '19:00': '1573A1', // #1573A1
      '20:00': '1573A1', // #1573A1
      '21:00': '1573A1', // #1573A1
      '22:00': '1573A1', // #1573A1
      '23:00': '1573A1', // #1573A1
      '24:00': '1573A1', // #1573A1
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) { }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );

    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Intraday Base Inventory Shipper',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  // --------- balancing monthly report start

  // https://nu-test01.nueamek.app/tpa-sit/20241213033138_original_png-transparent-singer-signature-the-20-20-experience-justified-signature-miscellaneous-angle-white-thumbnail.png
  // dcimal4
  async exportDataToExcelNewMontlyBalancing(
    dataRes: any,
    response: any,
    nameFile: string,
    userId?: any,
  ) {
    const { typeReportDB, typeReport, setDataUse } = dataRes;
    // userId = userId || 99999;
    const user = userId
      ? await this.prisma.account.findFirst({
        where: { id: Number(userId) },
        select: { first_name: true, last_name: true, signature: true },
      })
      : null;
    console.log('---- user : ', user);

    const sheetRowLimit = 100;
    const licenseSignature = user?.signature || null;
    const licenseFullName = `${user?.first_name || ''} ${user?.last_name || ''}`;

    if (!setDataUse || setDataUse.length === 0) {
      response
        .status(400)
        .send({ message: 'Data is empty. Cannot generate Excel file.' });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    let imageResponse = null as any;
    if (licenseSignature && typeof licenseSignature === 'string') {
      try {
        assertSafeExternalUrl(licenseSignature);
        imageResponse = await axios.get(licenseSignature, { responseType: 'arraybuffer' });
      } catch (e) {
        imageResponse = null;
      }
    }

    const valueDigitKeyPure = (pE: any) => {
      const resultKey =
        pE !== undefined && pE !== null ? this.dcimal4(pE) : null;

      return resultKey;
    };

    Object.entries(setDataUse).forEach(([index, valueObj]: any) => {
      const { key, value } = valueObj;
      const sheetData: any[] = [];

      const header0 = [
        'Date',
        'Entry Point',
        'Exit Point',
        'Entry - Exit',
        'Fuel Gas',
        'Balancing Gas',
        'Change Min Inventory',
        'Shrinkagate',
        'Commissiong',
        'Gas Vent',
        'Other Gas',
        'Imbalance',
        'Acc. Imbalance',
        'Min Inventory',
      ];
      sheetData.push(['']);
      sheetData.push(header0);

      value.forEach((item: any) => {
        const row = [
          item?.gas_day,
          valueDigitKeyPure(item?.value?.['Entry Point']),
          valueDigitKeyPure(item?.value?.['Exit']),
          valueDigitKeyPure(item?.value?.['Entry - Exit']),
          valueDigitKeyPure(item?.value?.['Fuel Gas']),
          valueDigitKeyPure(item?.value?.['Balancing Gas']),
          valueDigitKeyPure(item?.value?.['Change Min Inventory']),
          valueDigitKeyPure(item?.value?.['Shrinkagate']),
          valueDigitKeyPure(item?.value?.['Commissioning']),
          valueDigitKeyPure(item?.value?.['Gas Vent']),
          valueDigitKeyPure(item?.value?.['Other Gas']),
          valueDigitKeyPure(item?.value?.['Imbalance']),
          valueDigitKeyPure(item?.value?.['Acc. Imbqalance']),
          valueDigitKeyPure(item?.value?.['Min Inventory']),
        ];

        sheetData.push(row);
      });

      const chunkedRows = this.chunkArray(sheetData, sheetRowLimit);
      chunkedRows.forEach((rowsChunk, chunkIndex) => {
        const sheetName =
          chunkIndex === 0
            ? key.substring(0, 31)
            : `${key.substring(0, 28)} (${chunkIndex + 1})`;
        const ws = workbook.addWorksheet(sheetName);

        const effectiveRows = chunkIndex === 0 ? rowsChunk : rowsChunk.slice(1);
        // effectiveRows.forEach((row) => ws.addRow([...row]));
        effectiveRows.forEach((row, idx) => {
          const newRow = ws.addRow([...row]);

          if (newRow.number === 2) {
            newRow.eachCell((cell) => {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF002060' },
              };
              cell.font = {
                color: { argb: 'FFFFFFFF' },
                bold: true,
              };
              cell.alignment = {
                vertical: 'middle',
                horizontal: 'center',
                wrapText: true,
              };
            });
          } else if (newRow.number > 2) {
            if (newRow.getCell(1).value === 'sum') {
              newRow.eachCell((cell) => {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'E8FFEE' }, // สีเขียว (เช่น #E8FFEE)
                };
                cell.font = {
                  color: { argb: '06522E' }, // #06522E
                  bold: true,
                };
                cell.alignment = {
                  horizontal: 'right',
                  vertical: 'middle',
                  wrapText: true,
                };
              });
            } else {
              newRow.eachCell((cell) => {
                cell.alignment = {
                  horizontal: 'right',
                  vertical: 'middle',
                  wrapText: true,
                };
              });
            }
          }
        });

        // ✅ กำหนด style ให้ header row (row 2)
        const headerRow = ws.getRow(2);
        headerRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF002060' }, // พื้นหลัง #002060
          };
          cell.font = {
            color: { argb: 'FFFFFFFF' }, // สีข้อความขาว
            bold: true,
          };
          cell.alignment = {
            vertical: 'middle',
            horizontal: 'center',
            wrapText: true,
          };
        });

        ws.columns = Array.from({ length: 14 }, () => ({ width: 20 }));

        ws.getRow(1).hidden = true;
        // ✅ วางลายเซ็นทุก sheet
        // const signatureRow = ws.lastRow.number + 3;
        const signatureRow = Math.min(ws.lastRow.number, sheetRowLimit) + 3;
        const colIndex = 1;
        ws.getColumn(1).width = 30;
        ws.getRow(signatureRow).height = 50;
        const signatureCell = ws.getCell(signatureRow, colIndex);
        signatureCell.value = `( .................................................. )`;
        signatureCell.alignment = {
          horizontal: 'center',
          vertical: 'bottom',
          wrapText: true,
        };

        if (licenseSignature) {
          try {
            const imageBuffer = imageResponse.data;
            const imageId = workbook.addImage({
              buffer: imageBuffer,
              extension: 'png',
            });
            ws.addImage(imageId, {
              tl: { col: 0.95, row: signatureRow - 0.5 },
              ext: { width: 90, height: 40 },
            });
            const nameCell = ws.getCell(signatureRow + 2, colIndex);
            nameCell.value = licenseFullName;
            nameCell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            };
          } catch (err) {
            signatureCell.value = `( .................................................. )\n${licenseFullName}`;
          }
        } else {
          signatureCell.value = `( .................................................. )\n${licenseFullName}`;
        }
      });
    });
    console.log('----');
    const buffer = await workbook.xlsx.writeBuffer();
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD HH:mm')}_${nameFile}.xlsx"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(buffer);
  }

  // ---

  async epBalancingMonthlyReport(
    response: Response,
    payload: any,
    userId: any,
  ) {
    console.log('----- : ', userId);

    const resData = await this.balancingService.balancingMonthlyReport(
      payload,
      99999,
    );
    console.log('resData : ', resData);
    await this.exportDataToExcelNewMontlyBalancing(
      resData,
      response,
      'Balancing Monthly Report',
      userId,
    );
  }

  // --------- balancing monthly report end

  // excel old
  async balancingMonthlyReportDownload(
    response: Response,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    console.log('---- -');
    const resData =
      await this.balancingService.balancingMonthlyReportDownload();
    const idArray = bodys?.idAr;
    const filt = resData?.filter((f: any) => idArray?.includes(f?.id))
    //  tab
    const sortedResData = filt.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Month']: e['monthText'],
        ['Contract Code']: e['contractCode'],
        ['File']: e['file'],
        ['Report Version']: e['version'],
        ['Type Report']: e['typeReport'],
        ['Approved by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
      const filteredData = Object.keys(setData)
        .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    await this.exportDataToExcelNew(
      formateData,
      response,
      'Balancing Monthly Report Download',
      true,
    );
  }

  // new
  async epAllocationAllocationReport(response: Response, payload: any) {
    const { bodys, filter } = payload || {};

    const resData = await this.allocationService.allocationReport(bodys, 99999);
    const idArray = bodys?.idAr;
    //  tab
    const sortedResData = resData.sort(
      (a, b) => idArray.indexOf(a.id) - idArray.indexOf(b.id),
    );

    const valueDigitKeyPure = (pE: any) => {
      const resultKey =
        pE !== undefined && pE !== null ? this.dcimal4(pE) : null;

      return resultKey;
    };

    // dcimal4 unpublic
    // console.log('sortedResData : ', sortedResData);
    const formateData = await sortedResData.map((e: any) => {
      const setData = {
        ['Publication']: e['publication'] ? 'Public' : 'Unpublic',
        ['Entry / Exit']: e['entry_exit_obj']?.['name'],
        ['Gas Day']: e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '',
        ['Gas Hour']:
          (e['gas_hour'] &&
            `${e?.gas_hour >= 10 ? e?.gas_hour + ':00' : '0' + e?.gas_hour + ':00'}`) ||
          '', //
        ['Timestamp']:
          e['execute_timestamp'] &&
          dayjs(e['execute_timestamp'] * 1000).format('DD/MM/YYYY HH:mm'),
        ['Shipper Name']: e['group']?.['name'],
        ['Contract Code']: e['contract'],
        ['Contract Point']: e['contract_point'],
        ['Capacity Right (MMBTU/D)']: valueDigitKeyPure(e['contractCapacity']),
        ['Nominated Value (MMBTU/D)']: valueDigitKeyPure(e['nominationValue']),
        ['Intraday System Allocation (MMBTU/D)']: valueDigitKeyPure(
          e['intradaySystemAllocation'],
        ),
        ['System Allocation (MMBTU/D)']: valueDigitKeyPure(e['allocatedValue']),
        ['Overusage (MMBTU/D)']: valueDigitKeyPure(e['overusage']),
      };
      const filteredData = Object.keys(setData)
        // .filter((key) => filter.includes(key)) // กรอง key ที่ตรงกับ filter
        .reduce((obj, key) => {
          obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
          return obj;
        }, {});
      // filter
      return filteredData;
    });

    // ---------------- manage table excel
    console.log('formateData : ', formateData);

    // sort header
    const filterHeader = filter || [];


    // header color
    const headerColorMap = {
      Publication: '1573A1', // #1573A1
      'Entry / Exit': '1573A1', // #1573A1
      'Gas Day': '1573A1', // #1573A1
      'Gas Hour': '1573A1', // #1573A1
      Timestamp: '1573A1', // #1573A1
      'Shipper Name': '1573A1', // #1573A1
      'Contract Code': '1573A1', // #1573A1
      'Contract Point': '1573A1', // #1573A1
      'Capacity Right (MMBTU/D)': '1573A1', // #1573A1
      'Nominated Value (MMBTU/D)': '1573A1', // #1573A1
      'Intraday System Allocation (MMBTU/D)': '1573A1', // #1573A1
      'System Allocation (MMBTU/D)': '1573A1', // #1573A1
      'Overusage (MMBTU/D)': '1573A1', // #1573A1
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {

        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );

    const result = this.filterNestedData(formateData, filterHeader);

    const wb = XLSX.utils.book_new();
    const flatData = result.map((d) => this.flattenObjectNew(d));
    const allKeys = flatData[0].result;
    const allPaths = flatData[0].pathArray;

    const headers = Object.keys(allKeys);
    const headerRows = allPaths && this.buildHeaderRowsNew(allPaths);
    const ws = XLSX.utils.aoa_to_sheet([]);

    const rowOffset = 1; // ซ่อนแถวแรกไว้

    this.setWorkSheetDataAndStyle({
      ws,
      headerRows,
      rowOffset,
      flatData,
      headers,
      headerColorMap,
      cellHighlightMap,
    });

    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    try {
      // Group formateData by Entry / Exit, Gas Day, Gas Hour, Timestamp, Contract Code, Contract Point
      const groupedData = groupDataByFields(formateData, [
        'Shipper Name',
        'Contract Code',
        'Contract Point',
        'Entry / Exit',
        'Gas Day',
        'Gas Hour',
        'Timestamp',
      ]);

      const sub_sheet_total_record: number | undefined = undefined;
      let subSheetSkip = bodys?.skip;
      let subSheetLimit = bodys?.limit;
      // const byNomPointApi =
      // (bodys?.tab === '1')
      //     ? await this.allocationService.evidenApiAllocationContractPointByNom({
      //         start_date: bodys?.start_date,
      //         end_date: bodys?.end_date,
      //         skip: 0,
      //         limit: 1,
      //       },(totalRecord) => {
      //         sub_sheet_total_record = totalRecord;
      //       })
      //     : await this.allocationService.evidenApiAllocationContractPointIntradayByNom({
      //         start_date: bodys?.start_date,
      //         end_date: bodys?.end_date,
      //         skip: 0,
      //         limit: 1,
      //       },(totalRecord) => {
      //         sub_sheet_total_record = totalRecord;
      //       });
      if (sub_sheet_total_record) {
        subSheetSkip = 0;
        subSheetLimit = sub_sheet_total_record;
      }
      const subSheetResData = await this.allocationService.allocationReportView(
        {
          start_date: bodys?.start_date,
          end_date: bodys?.end_date,
          skip: subSheetSkip,
          limit: subSheetLimit,
          tab: bodys?.tab,
        },
        99999,
      );

      // Group subSheetResData based on groupedData keys
      const filteredSubSheetResData: Record<string, any[]> = {};

      subSheetResData.forEach((e: any) => {
        const shipperName = e['group']?.['name'];
        const entryExit = e['entry_exit_obj']?.['name'] || e['entry_exit'];
        const gasDay = e['gas_day']
          ? dayjs(e['gas_day']).format('DD/MM/YYYY')
          : '';
        const gasHour = e['gas_hour']
          ? `${e?.gas_hour >= 10 ? e?.gas_hour + ':00' : '0' + e?.gas_hour + ':00'}`
          : '';
        const timestamp =
          e['execute_timestamp'] &&
          dayjs(e['execute_timestamp'] * 1000).format('DD/MM/YYYY HH:mm');
        const contractCode = e['contract'];
        const contractPoint = e['relation_point'];

        // Create key matching the grouping logic
        const key = [
          shipperName,
          contractCode,
          contractPoint,
          entryExit,
          gasDay,
          gasHour,
          timestamp,
        ]
          .map((v) => v || '')
          .join('|');

        // Check if this item exists in our grouped data and add to filtered object
        if (groupedData.hasOwnProperty(key)) {
          if (filteredSubSheetResData[key]) {
            filteredSubSheetResData[key].push(e);
          } else {
            filteredSubSheetResData[key] = [e];
          }
        }
      });

      // console.log('Filtered subSheetResData:', Object.keys(filteredSubSheetResData).length, 'out of', subSheetResData.length);

      // Only process subsheet if we have filtered data
      const sheetNameList = Object.keys(filteredSubSheetResData).sort((a, b) =>
        a.localeCompare(b),
      );

      if (sheetNameList.length > 0) {
        const subSheetHeader = [
          'Entry / Exit',
          'Gas Day',
          'Timestamp',
          'Nomination Point/Concept Point',
          'Capacity Right (MMBTU/D)',
          'Nominated Value (MMBTU/D)',
          'System Allocation (MMBTU/D)',
        ];

        // header color
        const subSheetHeaderColorMap = {
          'Entry / Exit': '1573A1', // #1573A1
          'Gas Day': '1573A1', // #1573A1
          Timestamp: '1573A1', // #1573A1
          'Nomination Point/Concept Point': '1573A1', // #1573A1
          'Capacity Right (MMBTU/D)': '1573A1', // #1573A1
          'Nominated Value (MMBTU/D)': '1573A1', // #1573A1
          'System Allocation (MMBTU/D)': '1573A1', // #1573A1
        };

        const extraHeaderHeader = ['Contract Code', 'Contract Point', 'Timestamp']
        if (filterHeader.includes('Gas Hour')) {
          extraHeaderHeader.splice(2, 0, "Gas Hour")
        }

        const shortSheetNameList: string[] = []
        sheetNameList.map((originalKey: string, index: number) => {
          const subSheetFormatedData = filteredSubSheetResData[originalKey].map(
            (e: any) => {
              const setData = {
                ['Entry / Exit']:
                  e['entry_exit_obj']?.['name'] || e['entry_exit'],
                ['Gas Day']: e['gas_day']
                  ? dayjs(e['gas_day']).format('DD/MM/YYYY')
                  : '',
                ['Timestamp']:
                  e['execute_timestamp'] &&
                  dayjs(e['execute_timestamp'] * 1000).format(
                    'DD/MM/YYYY HH:mm',
                  ),
                ['Nomination Point/Concept Point']: e['point'],
                ['Capacity Right (MMBTU/D)']: valueDigitKeyPure(
                  e['contractCapacity'],
                ),
                ['Nominated Value (MMBTU/D)']: valueDigitKeyPure(
                  e['nominationValue'],
                ),
                ['System Allocation (MMBTU/D)']: valueDigitKeyPure(
                  e['allocatedValue'],
                ),
              };
              const filteredData = Object.keys(setData).reduce((obj, key) => {
                obj[key] = setData[key]; // เพิ่ม key และ value ที่ผ่านการกรอง
                return obj;
              }, {});
              // filter
              return filteredData;
            },
          );
          const subSheetCellHighlightMap = generateCellHighlightMapMultiple(
            subSheetHeader,
            subSheetFormatedData,
            'EAF5F8',
          );
          const subSheetResult = this.filterNestedData(
            subSheetFormatedData,
            subSheetHeader,
          );

          const subSheetFlatData = subSheetResult.map((d) =>
            this.flattenObjectNew(d),
          );
          const subSheetAllKeys = subSheetFlatData[0].result;
          const subSheetAllPaths = subSheetFlatData[0].pathArray;

          const subSheetHeaders = Object.keys(subSheetAllKeys);
          const subSheetHeaderRows = allPaths && this.buildHeaderRowsNew(subSheetAllPaths);
          const subWs = XLSX.utils.aoa_to_sheet([]);

          const parentData = groupedData[originalKey];
          const extraHeaderValue = [];
          extraHeaderHeader.map((key) => {
            if (parentData) {
              if (Array.isArray(parentData)) {
                if (parentData.length > 0) {
                  extraHeaderValue.push(parentData[0][key] || '')
                } else {
                  extraHeaderValue.push('')
                }
              } else {
                extraHeaderValue.push(parentData[key] || '')
              }
            }
          })


          this.setWorkSheetDataAndStyle({
            ws: subWs,
            headerRows: subSheetHeaderRows,
            rowOffset,
            flatData: subSheetFlatData,
            headers: subSheetHeaders,
            headerColorMap: subSheetHeaderColorMap,
            cellHighlightMap: subSheetCellHighlightMap,
            extraHeader: [extraHeaderHeader, extraHeaderValue]
          });

          // Extract contractCode, contractPoint, gasDay, gasHour from the first item in the group
          const firstItem = filteredSubSheetResData[originalKey][0];
          const contractCode = firstItem['contract'] || '';
          const contractPoint = firstItem['relation_point'] || '';
          const gasDay = firstItem['gas_day']
            ? dayjs(firstItem['gas_day']).format('DD/MM/YYYY')
            : '';
          const gasHour = firstItem['gas_hour']
            ? `${firstItem?.gas_hour >= 10 ? firstItem?.gas_hour + ':00' : '0' + firstItem?.gas_hour + ':00'}`
            : '';

          // Create shorter sheet name (max 31 chars)
          let sheetName = `${contractCode}|${contractPoint}|${gasDay}|${gasHour}`;

          // If still too long, truncate and add index
          if (sheetName.length > 31) {
            sheetName = `${contractCode}|${contractPoint}`;
            if (sheetName.length > 31) {
              sheetName = sheetName.substring(0, 30);
            }
          }

          if (shortSheetNameList.includes(sheetName)) {
            let counter = 1;
            let newSheetName = sheetName.substring(0, sheetName.length - 3) + `(${counter})`;

            while (shortSheetNameList.includes(newSheetName)) {
              counter++;
              newSheetName = sheetName.substring(0, sheetName.length - 3) + `(${counter})`;
            }

            sheetName = newSheetName;
          }
          shortSheetNameList.push(sheetName)

          XLSX.utils.book_append_sheet(wb, subWs, sheetName);
        });
      } else {
        console.log(
          'No matching data found for subsheet, skipping subsheet creation',
        );
      }
    } catch (err) {
      console.log('generate subsheet error : ', err);
    }

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    if (response) {
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${getTodayNowAdd7().format('YYYY-MM-DD_HH-mm')}_allocation_report.xlsx"`,
      );
      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.send(excelBuffer);
    } else {
      console.log('excelBuffer : ', excelBuffer);
      console.log('excelBuffer type:', typeof excelBuffer);
      console.log(
        'excelBuffer instanceof Buffer:',
        excelBuffer instanceof Buffer,
      );
      console.log('excelBuffer length:', excelBuffer?.length);
      console.log('------');

      return excelBuffer;
    }

    // return await this.exportDataToExcelWithMultiLevelHeaderNew(
    //   result,
    //   response,
    //   'Allocation Report',
    //   true,
    //   headerColorMap,
    //   cellHighlightMap,
    // );

    // await this.exportDataToExcelNew(
    //   formateData,
    //   response,
    //   'Allocation Report',
    //   true,
    // );
  }

  // http://10.100.101.15:8010/master/demoHtml
  async offspecGas(response: Response, payload: any, userId: any) {
    const { bodys, filter } = payload || {};
    const resData: any = await this.eventService.offspecGasAll(bodys, userId);

    // userId
    const userType = await this.prisma.user_type.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: userId,
          },
        },
      },
    });

    const nresData = resData?.data?.map((e: any) => {
      return {
        ['Event Code']: e['event_nember'] || '',
        ['Event Date']: e['event_date']
          ? dayjs(e['event_date']).format('DD/MM/YYYY')
          : '',
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Event Status']: null,
        ...e,
      };
    });

    // console.log('nresData : ', nresData);

    const formateData = await nresData.map((e: any) => {
      let shipperD2 = null;
      let shipperD3 = null;
      let tsoD2 = null;
      let tsoD3 = null;

      if (userType?.id === 3) {
        shipperD2 =
          (e?.['document2'] &&
            e['document2']?.['event_doc_status_id'] !== 1 &&
            e['document2']?.['event_doc_status_id'] !== 2 &&
            e?.['document2']?.['event_doc_status']?.name) ||
          '';
        shipperD3 =
          (e?.['document3'] &&
            e['document3']?.['event_doc_status_id'] === 5 &&
            e?.['document3']?.['event_doc_status']?.name) ||
          '';
      } else {
        tsoD2 =
          userType && e?.['document2']?.length === 0
            ? ''
            : `${e?.['document2']?.filter((item) => item?.event_doc_status_id !== 2).length || 0}/${e?.['document2']?.length || 0}` ||
            '';
        tsoD3 =
          userType && e?.['document3']?.length === 0
            ? ''
            : `${e?.['document3']?.filter((item) => item?.event_doc_status_id === 5).length || 0}/${e?.['document3']?.length || 0}` ||
            '';
      }
      const setData = {
        ['Event Code']: e?.['Event Code'] || '',
        ['Event Date']: e?.['Event Date'] || '',
        ['Document 1']: {
          ['Status']:
            e?.['document1']?.['event_doc_status_id'] !== 3 &&
              e?.['document1']?.['event_doc_status_id'] !== 4 &&
              e?.['document1']?.['event_doc_status_id'] !== 5 &&
              e?.['document1']?.['event_doc_status_id'] !== 6
              ? ''
              : e?.['document1']?.['event_doc_status']?.['name'],
        },
        ['Document 2']: {
          ['Shipper']: userType && userType?.id === 3 ? shipperD2 : tsoD2 || '',
        },
        ['Document 3']: {
          ['Shipper']: userType && userType?.id === 3 ? shipperD3 : tsoD3 || '',
        },
        ['Created by']: e?.['Created by'] || '',
        ['Event Status']: e?.['event_status']?.['name'] || '',
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //   "Event Code",
    //   "Event Date",

    //   "Document 1",
    //   "Document 1.Status",
    //   "Document 2",
    //   "Document 2.Shipper",
    //   "Document 3",
    //   "Document 3.Shipper",
    //   "Created by",
    //   "Event Status"

    // ];

    // header color
    const headerColorMap = {
      'Event Code': '1573A1', // #1573A1
      'Event Date': '1573A1', // #1573A1
      'Document 1': '1573A1', // #1573A1
      'Document 1.Status': '24adec', // #24adec
      'Document 2': '1573A1', // #1573A1
      'Document 2.Shipper': '24adec', // #24adec
      'Document 3': '1573A1', // #1573A1
      'Document 3.Shipper': '24adec', // #24adec
      'Created by': '1573A1', // #1573A1
      'Event Status': '1573A1', // #1573A1
    };

    const getValidationColorClass = (validation?: string): string => {
      const map: Record<string, string> = {
        normal: 'BEEB8E',
        alert: 'F8F889',
        ofo: 'FFC9C9',
        dd: 'E9D2FF',
        if: 'FD9965',
      };

      return map[validation?.toLowerCase() ?? ''] ?? 'FFFFFF';
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          // result[key][i] = color;
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };
    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Offscpe Gas',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  getAcknowledgeStatus = (docArray: any) => {
    // จัดกลุ่มตาม group_id
    const groups: any = docArray?.reduce((acc: any, item: any) => {
      const key = item.group_id;
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});
    console.log('docArray', docArray)
    console.log('groups', groups)

    let totalGroups = 0;
    let fullyAcknowledgedGroups = 0;

    let group: any;
    for (group of Object.values(groups)) {
      totalGroups += 1;
      const allStatus5 = group.every(
        (item: any) => item.event_doc_status_id === 5,
      ); // เอาแค่ acknowledge
      if (allStatus5) fullyAcknowledgedGroups += 1;
    }

    return {
      text:
        totalGroups === 0 ? '' : `${fullyAcknowledgedGroups}/${totalGroups}`,
      equ: fullyAcknowledgedGroups === totalGroups,
    };
  };

  async emergencyDifficultDay(response: Response, payload: any, userId: any) {
    const { bodys, filter } = payload || {};
    const resData: any = await this.eventService.emerAll(bodys, userId);

    // userId
    const userType = await this.prisma.user_type.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: userId,
          },
        },
      },
    });
    console.log('resData?.data : ', resData?.data);
    const nresData = resData?.data?.map((e: any) => {
      const clean = (name) =>
        name.startsWith('Onshore ') ? name.slice(8) : name;

      return {
        ['Event Code']: e['event_nember'] || '',
        // ['Event Date']: e['event_date'] || '',
        ['Type']: e['event_doc_emer_type']?.['name_en'] || '',
        ['Event Date']: e['event_date']
          ? dayjs(e['event_date']).format('DD/MM/YYYY')
          : '',
        ['Zone']: e['event_doc_emer_gas_tranmiss_id']
          ? e['event_doc_emer_gas_tranmiss_id'] === 5
            ? e['event_doc_emer_gas_tranmiss_other']
            : clean(e['event_doc_emer_gas_tranmiss']?.['name'])
          : '',
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Event Status']: null,
        ...e,
      };
    });

    console.log('nresData : ', nresData);

    const formateData = await nresData?.map((e: any) => {
      let shipperstatusD39 = null;
      let tsoD39 = null;
      let tsostatusD39 = null;

      let shipperstatusD4 = null;
      let tsoD4 = null;
      let tsostatusD4 = null;

      let shipperstatusD5 = null;
      let tsoD5 = null;
      let tsostatusD5 = null;

      let shipperstatusD6 = null;
      let tsoD6 = null;
      let tsostatusD6 = null;

      if (userType?.id === 3) {
        shipperstatusD39 =
          e['document39']?.['event_doc_status_id'] !== 5 &&
            e['document39']?.['event_doc_status_id'] !== 6
            ? ''
            : e['document39']?.['event_doc_status']?.['name'];
        shipperstatusD4 =
          e?.['document4']?.length > 0
            ? this.getAcknowledgeStatus(e?.['document4'])?.equ
              ? 'Acknowledge'
              : ''
            : '';
        shipperstatusD5 =
          e['document5']?.['event_doc_status_id'] !== 5 &&
            e['document5']?.['event_doc_status_id'] !== 6
            ? ''
            : e['document5']?.['event_doc_status']?.['name'];
        shipperstatusD6 =
          e['document6']?.['event_doc_status_id'] !== 5 &&
            e['document6']?.['event_doc_status_id'] !== 6
            ? ''
            : e['document6']?.['event_doc_status']?.['name'];
      } else {
        tsoD39 =
          userType && e?.['document39']?.length === 0
            ? ''
            : `${e?.['document39']?.filter((item) => item?.event_doc_status_id !== 2).length || 0}/${e?.['document39']?.length || 0}` ||
            '';
        tsostatusD39 =
          e?.['document39']?.length > 0
            ? e?.['document39']?.filter(
              (item) => item?.event_doc_status_id === 5,
            ).length === e?.['document39']?.length
              ? 'Open'
              : 'Closed'
            : '';
        tsoD4 = e?.['document4'] && this.getAcknowledgeStatus(e?.['document4'])?.text;
        ((tsostatusD4 =
          e?.['document4']?.length > 0
            ? e?.['document4']?.find((f: any) => f?.event_doc_status_id === 6)
              ? 'Generated'
              : this.getAcknowledgeStatus(e?.['document4'])?.equ
                ? 'Open'
                : 'Closed'
            : ''),
          (tsoD5 =
            userType && e?.['document5']?.length === 0
              ? ''
              : `${e?.['document5']?.filter((item) => item?.event_doc_status_id !== 2).length || 0}/${e?.['document5']?.length || 0}` ||
              ''));
        tsostatusD5 =
          e?.['document5']?.length > 0
            ? e?.['document5']?.filter(
              (item) => item?.event_doc_status_id === 5,
            ).length === e?.['document5']?.length
              ? 'Open'
              : 'Closed'
            : '';
        tsoD6 =
          userType && e?.['document6']?.length === 0
            ? ''
            : `${e?.['document6']?.filter((item) => item?.event_doc_status_id !== 2).length || 0}/${e?.['document6']?.length || 0}` ||
            '';
        tsostatusD6 =
          e?.['document6']?.length > 0
            ? e?.['document6']?.filter(
              (item) => item?.event_doc_status_id === 5,
            ).length === e?.['document6']?.length
              ? 'Open'
              : 'Closed'
            : '';
      }
      const setData = {
        ['Event Code']: e['Event Code'] || '',
        ['Type']: e['Type'] || '',
        ['Event Date']: e['Event Date'] || '',
        ['Zone']: e['Zone'] || '',
        ['Document 3.9']: {
          ...(userType?.id === 3
            ? {
              ['Acknowledge']: shipperstatusD39 || '',
            }
            : {
              ['Shipper']: tsoD39 || '',
              ['Status']: tsostatusD39 || '',
            }),
        },
        ['Document 4']: {
          ...(userType?.id === 3
            ? {
              ['Acknowledge']: shipperstatusD4 || '',
            }
            : {
              ['Shipper']: tsoD4 || '',
              ['Status']: tsostatusD4 || '',
            }),
        },
        ['Document 5']: {
          ...(userType?.id === 3
            ? {
              ['Acknowledge']: shipperstatusD5 || '',
            }
            : {
              ['Shipper']: tsoD5 || '',
              ['Status']: tsostatusD5 || '',
            }),
        },
        ['Document 6']: {
          ...(userType?.id === 3
            ? {
              ['Acknowledge']: shipperstatusD6 || '',
            }
            : {
              ['Shipper']: tsoD6 || '',
              ['Status']: tsostatusD6 || '',
            }),
        },

        ['Created by']: e['Created by'] || '',
        ['Event Status']: e['event_status']?.['name'] || '',
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //   "Event Code",
    //   "Type",
    //   "Date",
    //   "Zone",

    //   "Document 3.9",
    //   "Document 3.9.Shipper",
    //   "Document 3.9.Status",
    //   "Document 3.9.Acknowledge",
    //   "Document 4",
    //   "Document 4.Shipper",
    //   "Document 4.Status",
    //   "Document 4.Acknowledge",
    //   "Document 5",
    //   "Document 5.Shipper",
    //   "Document 5.Status",
    //   "Document 5.Acknowledge",
    //   "Document 6",
    //   "Document 6.Shipper",
    //   "Document 6.Status",
    //   "Document 6.Acknowledge",
    //   "Created by",
    //   "Event Status"

    // ]

    // header color
    const headerColorMap = {
      'Event Code': '1573A1', // #1573A1
      Type: '1573A1', // #1573A1
      "Event Date": '1573A1', // #1573A1
      Zone: '1573A1', // #1573A1
      'Document 3.9': '1573A1', // #1573A1
      'Document 3.9.Shipper': '24adec', // #24adec
      'Document 3.9.Status': '24adec', // #24adec
      'Document 3.9.Acknowledge': '24adec', // #24adec
      'Document 4': '1573A1', // #1573A1
      'Document 4.Shipper': '24adec', // #24adec
      'Document 4.Status': '24adec', // #24adec
      'Document 4.Acknowledge': '24adec', // #24adec
      'Document 5': '1573A1', // #1573A1
      'Document 5.Shipper': '24adec', // #24adec
      'Document 5.Status': '24adec', // #24adec
      'Document 5.Acknowledge': '24adec', // #24adec
      'Document 6': '1573A1', // #1573A1
      'Document 6.Shipper': '24adec', // #24adec
      'Document 6.Status': '24adec', // #24adec
      'Document 6.Acknowledge': '24adec', // #24adec
      'Created by': '1573A1', // #1573A1
      'Event Status': '1573A1', // #1573A1
    };

    const getValidationColorClass = (validation?: string): string => {
      const map: Record<string, string> = {
        normal: 'BEEB8E',
        alert: 'F8F889',
        ofo: 'FFC9C9',
        dd: 'E9D2FF',
        if: 'FD9965',
      };

      return map[validation?.toLowerCase() ?? ''] ?? 'FFFFFF';
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          // result[key][i] = color;
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };
    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Emergency Difficult Day',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }
  // 
  async ofo(response: Response, payload: any, userId: any) {
    const { bodys, filter } = payload || {};
    console.log('...bodys : ', bodys);
    const resData: any = await this.eventService.ofoAll(bodys, userId);
    console.log('...resData : ', resData);
    // userId
    const userType = await this.prisma.user_type.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: userId,
          },
        },
      },
    });

    const nresData = resData?.data?.map((e: any) => {
      return {
        ['Event Code']: e['event_nember'] || '',
        ['Type']: e['event_doc_ofo_type']?.['name_en'] || '',
        ['Event Date']: e['event_date']
          ? dayjs(e['event_date']).format('DD/MM/YYYY')
          : '',
        ['Created by']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Event Status']: null,
        ...e,
      };
    });

    console.log('nresData : ', nresData);

    const formateData = await nresData.map((e: any) => {
      let shipperstatusD7 = null;
      let tsoD7 = null;
      let tsostatusD7 = null;

      let shipperstatusD8 = null;
      let tsoD8 = null;
      let tsostatusD8 = null;


      if (userType?.id === 3) {
        shipperstatusD7 =
          e?.['document7']?.length > 0
            ? this.getAcknowledgeStatus(e?.['document7'])?.equ
              ? 'Acknowledge'
              : ''
            : '';
        shipperstatusD8 =
          e['document8']?.['event_doc_status_id'] !== 5 &&
            e['document8']?.['event_doc_status_id'] !== 6
            ? ''
            : e['document8']?.['event_doc_status']?.['name'];
      } else {
        tsoD7 = this.getAcknowledgeStatus(e?.['document7'])?.text;
        ((tsostatusD7 =
          e?.['document7']?.length > 0
            ? e?.['document7']?.find((f: any) => f?.event_doc_status_id === 6)
              ? 'Generated'
              : this.getAcknowledgeStatus(e?.['document7'])?.equ
                ? 'Closed'
                : 'Open'
            : ''),
          (tsoD8 =
            userType && e?.['document8']?.length === 0
              ? ''
              : `${e?.['document8']?.filter((item) => item?.event_doc_status_id !== 2).length || 0}/${e?.['document8']?.length || 0}` ||
              ''));
        tsostatusD8 =
          e?.['document8']?.length > 0
            ? e?.['document8']?.filter(
              (item) => item?.event_doc_status_id === 5,
            ).length === e?.['document8']?.length
              ? 'Open'
              : 'Closed'
            : '';
      }
      const setData = {
        ['Event Code']: e['Event Code'] || '',
        ['Type']: e['Type'] || '',
        ['Event Date']: e['Event Date'] || '',

        ['Document 7']: {
          ...(userType?.id === 3
            ? {
              ['Acknowledge']: shipperstatusD7 || '',
            }
            : {
              ['Shipper']: tsoD7 || '',
              ['Status']: tsostatusD7 || '',
            }),
        },
        ['Document 8']: {
          ...(userType?.id === 3
            ? {
              ['Acknowledge']: shipperstatusD8 || '',
            }
            : {
              ['Shipper']: tsoD8 || '',
              ['Status']: tsostatusD8 || '',
            }),
        },

        ['Created by']: e['Created by'] || '',
        ['Event Status']: e['event_status']?.['name'] || '',
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //   "Event Code",
    //   "Type",
    //   "Event Date",

    //   "Document 7",
    //   "Document 7.Shipper",
    //   "Document 7.Status",
    //   "Document 7.Acknowledge",
    //   "Document 8",
    //   "Document 8.Shipper",
    //   "Document 8.Status",
    //   "Document 8.Acknowledge",
    //   "Created by",
    //   "Event Status"

    // ]

    // header color
    const headerColorMap = {
      'Event Code': '1573A1', // #1573A1
      Type: '1573A1', // #1573A1
      'Event Date': '1573A1', // #1573A1
      'Document 7': '1573A1', // #1573A1
      'Document 7.Shipper': '24adec', // #24adec
      'Document 7.Status': '24adec', // #24adec
      'Document 7.Acknowledge': '24adec', // #24adec
      'Document 8': '1573A1', // #1573A1
      'Document 8.Shipper': '24adec', // #24adec
      'Document 8.Status': '24adec', // #24adec
      'Document 8.Acknowledge': '24adec', // #24adec
      'Created by': '1573A1', // #1573A1
      'Event Status': '1573A1', // #1573A1
    };

    const getValidationColorClass = (validation?: string): string => {
      const map: Record<string, string> = {
        normal: 'BEEB8E',
        alert: 'F8F889',
        ofo: 'FFC9C9',
        dd: 'E9D2FF',
        if: 'FD9965',
      };

      return map[validation?.toLowerCase() ?? ''] ?? 'FFFFFF';
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          // result[key][i] = color;
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };
    const result = this.filterNestedData(formateData, filterHeader);
    console.log('---result : ', result);
    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'OFO',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  // Tariff
  async tariffChargeReport(response: Response, payload: any, userId: any) {
    const { bodys, filter } = payload || {};
    const resData: any = await this.tariffService.tariffChargeReportFindAll(
      bodys,
      userId,
    );
    console.log('resData : ', resData);

    const nresData = resData?.data?.map((e: any) => {
      const lengthSubmission =
        (e['tariff_comment'].length > 0 &&
          e['tariff_comment']
            .map((tariff_comment: any) => `${tariff_comment?.comment}`)
            .join(',')) ||
        '';

      return {
        ['Tariff ID']: e['tariff_id'] || '',
        ['Shipper Name']: e['shipper']?.['name'] || '',
        ['Month/Year Charge']: e['month_year_charge']
          ? dayjs(e['month_year_charge']).format('MMMM YYYY')
          : '',
        ['Type']: e['tariff_type']?.['name'] || '',

        ['Timestamp']: e['create_date']
          ? dayjs(e['create_date']).format('DD/MM/YYYY HH:mm:ss')
          : '',
        ['Invoice Sent']: e['tariff_invoice_sent']?.['name'] || '',
        ['Comment']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission, // ""
        ['Created By']: `${(!!e['create_by_account']?.['first_name'] &&
          e['create_by_account']?.['first_name']) ||
          ''
          } ${(!!e['create_by_account']?.['last_name'] &&
            e['create_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
        ['Updated By']: `${(!!e['update_by_account']?.['first_name'] &&
          e['update_by_account']?.['first_name']) ||
          ''
          } ${(!!e['update_by_account']?.['last_name'] &&
            e['update_by_account']?.['last_name']) ||
          ''
          } ${e['create_date']
            ? '(' + dayjs(e['create_date']).format('DD/MM/YYYY HH:mm') + ')'
            : ''
          }`,
      };
    });

    console.log('nresData : ', nresData);

    const formateData = await nresData.map((e: any) => {
      const setData = {
        ['Tariff ID']: e['Tariff ID'] || '',
        ['Shipper Name']: e['Shipper Name'] || '',
        ['Month/Year Charge']: e['Month/Year Charge'] || '',
        ['Type']: e['Type'] || '',
        ['Timestamp']: e['Timestamp'] || '',
        ['Invoice Sent']: e['Invoice Sent'] || '',
        ['Comment']: e['Comment'] || '',
        ['Created By']: e['Created By'] || '',
        ['Updated By']: e['Updated By'] || '',
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //   "Tariff ID",
    //   "Shipper Name",
    //   "Month/Year Charge",
    //   "Type",
    //   "Timestamp",
    //   "Invoice Sent",
    //   "Comment",
    //   "Created By",
    //   "Updated By"
    // ];

    // header color
    const headerColorMap = {
      'Tariff ID': '1573A1', // #1573A1
      'Shipper Name': '1573A1', // #1573A1
      'Month/Year Charge': '1573A1', // #1573A1
      Type: '1573A1', // #1573A1
      Timestamp: '1573A1', // #1573A1
      'Invoice Sent': '1573A1', // #1573A1
      Comment: '1573A1', // #1573A1
      'Created By': '1573A1', // #1573A1
      'Updated By': '1573A1', // #1573A1
    };

    const getValidationColorClass = (validation?: string): string => {
      const map: Record<string, string> = {
        normal: 'BEEB8E',
        alert: 'F8F889',
        ofo: 'FFC9C9',
        dd: 'E9D2FF',
        if: 'FD9965',
      };

      return map[validation?.toLowerCase() ?? ''] ?? 'FFFFFF';
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          // result[key][i] = color;
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };
    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Tariff Charge Report',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  async tariffCreditDebitNote(response: Response, payload: any, userId: any) {
    const { bodys, filter } = payload || {};
    const resData: any = await this.tariffService.findAllTariffCreditDebitNote(
      bodys,
      userId,
    );
    console.log('resData : ', resData);
    const nresData = resData?.data?.map((e: any) => {
      const lengthSubmission =
        (e['tariff_credit_debit_note_comment'].length > 0 &&
          e['tariff_credit_debit_note_comment']
            .map(
              (tariff_credit_debit_note_comment: any) =>
                `${tariff_credit_debit_note_comment?.comment}`,
            )
            .join(',')) ||
        '';

      return {
        ['Shipper Name']: e['shipper']?.['name'] || '',
        ['Month/Year']: e['month_year_charge']
          ? dayjs(e['month_year_charge']).format('MMMM YYYY')
          : '',
        ['CNDN ID']: e['cndn_id'] || '',
        ['Type Charge']: e['tariff_type_charge']?.['name'] || '',
        ['CNDN Type']: e['tariff_credit_debit_note_type']?.['name'] || '',
        ['Comment']:
          lengthSubmission.length > 32767
            ? lengthSubmission.slice(0, 32700) + 'เกินลิมิตแล้วโปรดดูที่เว็บ'
            : lengthSubmission, // ""
      };
    });

    // console.log('nresData : ', nresData);

    const formateData = await nresData.map((e: any) => {
      const setData = {
        ['Shipper Name']: e['Shipper Name'] || '',
        ['Month/Year']: e['Month/Year'] || '',
        ['CNDN ID']: e['CNDN ID'] || '',
        ['Type Charge']: e['Type Charge'] || '',
        ['CNDN Type']: e['CNDN Type'] || '',
        ['Invoice Sent']: e['Invoice Sent'] || '',
        ['Comment']: e['Comment'] || '',
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //   "Shipper Name",
    //   "Month/Year",
    //   "CNCD ID",
    //   "Type Charge",
    //   "CNCD Type",
    //   "Comment"
    // ]

    // header color
    const headerColorMap = {
      'Shipper Name': '1573A1', // #1573A1
      'Month/Year': '1573A1', // #1573A1
      'CNDN ID': '1573A1', // #1573A1
      'Type Charge': '1573A1', // #1573A1
      'CNDN Type': '1573A1', // #1573A1
      Comment: '1573A1', // #1573A1
    };

    const getValidationColorClass = (validation?: string): string => {
      const map: Record<string, string> = {
        normal: 'BEEB8E',
        alert: 'F8F889',
        ofo: 'FFC9C9',
        dd: 'E9D2FF',
        if: 'FD9965',
      };

      return map[validation?.toLowerCase() ?? ''] ?? 'FFFFFF';
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          // result[key][i] = color;
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    // value color
    // const cellHighlightMap: Record<string, Record<number, string>> = {
    //   'Exit(MMBTU).West': {
    //     1: 'EAF5F8', // #EAF5F8
    //   },
    //   'Exit(MMBTU).East': {
    //     1: 'FFAAAA', // index 1 (แถวที่สอง) ให้พื้นหลังชมพูอ่อน
    //   },
    // };
    const result = this.filterNestedData(formateData, filterHeader);

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Tariff Credit/Debit Note',
      true,
      headerColorMap,
      cellHighlightMap,
    );
  }

  // view tariff-charge-report Capacity Charge
  async tariffChargeReportCapacityCharge(
    response: Response,
    id: any,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    if (bodys?.tariff_type_charge_id !== 1) {
      throw new Error('Error tariff_type_charge_id.');
    }
    const resData: any = await this.tariffService.chargeView(
      { id: Number(id) },
      userId,
    );
    const dataUse = resData?.[0]?.data?.booking_row_json_use || [];

    const entry = dataUse
      ?.filter((f: any) => f?.entry_exit_id === 1)
      ?.map((e: any) => {
        const capacityMMBTUValue =
          e['capacityMMBTUValue'] === null
            ? null
            : Number(String(e['capacityMMBTUValue'] || '').trim().replace(/,/g, '')) || 0;
        return {
          ['Area']: e['areaObj']?.['name'] || '',
          ['Capacity Right (MMBTU)']: capacityMMBTUValue,
          ['type']: '1',
        };
      });

    const totalEntry = [
      {
        ['Area']: 'Total Entry',
        ['Capacity Right (MMBTU)']: entry
          ?.filter((f: any) => f?.['Capacity Right (MMBTU)'] !== null)
          ?.reduce(
            (accumulator, currentValue) =>
              accumulator + currentValue?.['Capacity Right (MMBTU)'],
            0,
          ),
        ['type']: '2',
      },
    ];

    const exit = dataUse
      ?.filter((f: any) => f?.entry_exit_id === 2)
      ?.map((e: any) => {
        const capacityMMBTUValue =
          e['capacityMMBTUValue'] === null
            ? null
            : Number(String(e['capacityMMBTUValue'] || '').trim().replace(/,/g, '')) || 0;
        return {
          ['Area']: e['areaObj']?.['name'] || '',
          ['Capacity Right (MMBTU)']: capacityMMBTUValue,
          ['type']: '1',
        };
      });

    const totalExit = [
      {
        ['Area']: 'Total Entry',
        ['Capacity Right (MMBTU)']: exit
          ?.filter((f: any) => f?.['Capacity Right (MMBTU)'] !== null)
          ?.reduce(
            (accumulator, currentValue) =>
              accumulator + currentValue?.['Capacity Right (MMBTU)'],
            0,
          ),
        ['type']: '2',
      },
    ];

    const totalAll = [
      {
        ['Area']: 'Total',
        ['Capacity Right (MMBTU)']: [...totalEntry, ...totalExit]
          ?.filter((f: any) => f?.['Capacity Right (MMBTU)'] !== null)
          ?.reduce(
            (accumulator, currentValue) =>
              accumulator + currentValue?.['Capacity Right (MMBTU)'],
            0,
          ),
        ['type']: '3',
      },
    ];

    const nresData = [
      ...entry,
      ...totalEntry,
      ...exit,
      ...totalExit,
      ...totalAll,
    ];

    console.log('nresData : ', nresData);

    const formateData = await nresData.map((e: any) => {
      const setData = {
        ['Area']: e['Area'] || '',
        ['Capacity Right (MMBTU)']: e['Capacity Right (MMBTU)'] || '',
        ['type']: e['type'],
      };
      const filteredData = Object.keys(setData).reduce((obj, key) => {
        obj[key] = setData[key];
        return obj;
      }, {});

      return filteredData;
    });

    // ---------------- manage table excel

    // sort header
    const filterHeader = filter || [];
    // const filterHeader = [
    //   "Area",
    //   "Capacity Right (MMBTU)"
    // ]

    // header color
    const headerColorMap = {
      Area: '1573A1', // #1573A1
      'Capacity Right (MMBTU)': '1573A1', // #1573A1
    };

    const getValidationColorClass = (validation?: string): string => {
      const map: Record<string, string> = {
        normal: 'BEEB8E',
        alert: 'F8F889',
        ofo: 'FFC9C9',
        dd: 'E9D2FF',
        if: 'FD9965',
      };

      return map[validation?.toLowerCase() ?? ''] ?? 'FFFFFF';
    };

    function generateCellHighlightMapMultiple(
      keys: string[],
      data: any[],
      color: string,
    ): Record<string, Record<number, string>> {
      const result: Record<string, Record<number, string>> = {};

      for (const key of keys) {
        result[key] = {};
        for (let i = 0; i < data.length; i++) {
          if (data[i]?.['type'] === '2') {
            result[key][i] = 'e0f7ff'; //#e0f7ff
          } else if (data[i]?.['type'] === '3') {
            result[key][i] = 'ffffdf'; //#ffffdf
          }
        }
      }

      return result;
    }

    const cellHighlightMap = generateCellHighlightMapMultiple(
      filterHeader,
      formateData,
      'EAF5F8',
    );
    const result = this.filterNestedData(formateData, filterHeader);

    const defaultDecimal = 3
    const keyAndDecimalMap: Record<string, { index: number, decimal: number }[]> = {
      'Capacity Right (MMBTU)': result.map((item: any, index: number) => {
        return {
          index,
          decimal: item.Area.includes('Total') ? 4 : defaultDecimal
        }
      })
    }

    return await this.exportDataToExcelWithMultiLevelHeaderNew(
      result,
      response,
      'Tariff Charge Report / CapacityCharge',
      true,
      headerColorMap,
      cellHighlightMap,
      keyAndDecimalMap
    );
  }

  // ...view tariff-charge-report Commodity Charge มี 2 type by contract, shipper | customer_type เอาจาก tempDateArr[0]?.customer_type
  async tariffChargeReportCommodityChargeExternalA(
    response: Response,
    id: any,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    if (bodys?.tariff_type_charge_id !== 2) {
      throw new Error('Error tariff_type_charge_id.');
    }
    const resData: any = await this.tariffService.chargeView(
      { id: Number(id) },
      userId,
    );
    const dataUse = resData?.[0] || [];
    const month_year_charge = dataUse?.tariff_charge?.tariff?.month_year_charge;
    const YYYYMM01 = getTodayNowAdd7(month_year_charge).format('YYYY-MM-01');
    const dayArrs = this.monthDateArray(YYYYMM01);
    console.log('dataUse : ', dataUse);
    console.log('dayArrs : ', dayArrs);

    const results = dataUse?.data?.value?.map((fm: any) => {

      // const dayMo = dayArrs?.map((dm: any, im: any) => {
      //   const find = fm?.tempDateArr?.find((f: any) => f?.gas_day === dm)?.[
      //     keys
      //   ];
      //   return {
      //     [dm]: find || '',
      //   };
      // });
      // tempDateArr
      const customerType = fm?.tempDateArr?.[0]?.customer_type
      const dayFormat = dayArrs?.map((e: any, ix: number) => {
        const findData = fm?.tempDateArr?.find((f: any) => f?.gas_day === e)
        return {
          // dateDefalut: e,
          ["Date"]: ix + 1,
          ["GAS ENERGY (MMBTU)"]: {
            ["Final Allocation"]: findData?.nominationValue || "",
            ["Statement of Gas Delivered"]: "", //meter ล่าสุดของวันนั้น
            ["Gas Allocation"]: findData?.nominationValue || ""
          },
          ["Sta. Std. Vol. Allocataion (MMSCF)"]: "",
          ["Remark"]: ""
        }
      })
      // console.log('dayFormat : ', dayFormat);
      return {
        nomPoint: fm?.point || "",
        calc: fm?.calc || "",
        calcNotRound: fm?.calcNotRound || "",
        customerType: customerType || "",
        dayFormat: dayFormat || [],
        total: {
          ["Date"]: "",
          ["GAS ENERGY (MMBTU)"]: {
            ["Final Allocation"]: dayFormat?.filter((f: any) => f?.["GAS ENERGY (MMBTU)"]?.["Final Allocation"] !== "")?.reduce(
              (accumulator, currentValue) => accumulator + Number(currentValue?.["GAS ENERGY (MMBTU)"]?.["Final Allocation"]),
              0,
            ),
            ["Statement of Gas Delivered"]: dayFormat?.filter((f: any) => f?.["GAS ENERGY (MMBTU)"]?.["Statement of Gas Delivered"] !== "")?.reduce(
              (accumulator, currentValue) => accumulator + Number(currentValue?.["GAS ENERGY (MMBTU)"]?.["Statement of Gas Delivered"]),
              0,
            ),
            ["Gas Allocation"]: dayFormat?.filter((f: any) => f?.["GAS ENERGY (MMBTU)"]?.["Gas Allocation"] !== "")?.reduce(
              (accumulator, currentValue) => accumulator + Number(currentValue?.["GAS ENERGY (MMBTU)"]?.["Gas Allocation"]),
              0,
            ),
          },
          ["Sta. Std. Vol. Allocataion (MMSCF)"]: "",
          ["Remark"]: ""
        }

      };
    });
    console.log('results : ', results); // ทำ multi sheet
    // const allocationData = fnMapData('allocatedValue', 'Actual');
    // const contractCapacityData = fnMapData('contractCapacity', 'Booking');
    // const overusageData = fnMapData('overusage', 'Overuse');

    return
  }

  // ...
  async tariffChargeReportCommodityChargeInternalA(
    response: Response,
    id: any,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    if (bodys?.tariff_type_charge_id !== 2) {
      throw new Error('Error tariff_type_charge_id.');
    }
    const resData: any = await this.tariffService.chargeView(
      { id: Number(id) },
      userId,
    );
    const dataUse = resData?.[0] || [];
    const month_year_charge = dataUse?.tariff_charge?.tariff?.month_year_charge;
    const YYYYMM01 = getTodayNowAdd7(month_year_charge).format('YYYY-MM-01');
    const dayArrs = this.monthDateArray(YYYYMM01);
    console.log('dataUse : ', dataUse);
    console.log('dayArrs : ', dayArrs);

    const results = dataUse?.data?.value?.map((fm: any) => {


      const customerType = fm?.tempDateArr?.[0]?.customer_type

      // console.log('dayFormat : ', dayFormat);
      return {
        ["FID"]: fm?.point || "",
        ["Name"]: "", // มาจาก nom description
        ["Valume (MMSCF)"]: "", // ใส่ blank
        ["Energy (MMBTU)"]: dataUse?.data?.quantity, // ค่ามาจากหน้า Detail Column Allocate Exit Quantity แล้ว round ค่าที่นี้
        ["Region"]: "", // ใส่ blank
        ["Group"]: customerType || "",
        ["Zone"]: "Zone 3", // ใส่ blank

      };
    });
    console.log('results : ', results); // ทำ multi sheet
    // const allocationData = fnMapData('allocatedValue', 'Actual');
    // const contractCapacityData = fnMapData('contractCapacity', 'Booking');
    // const overusageData = fnMapData('overusage', 'Overuse');

    return
  }

  async tariffChargeReportCommodityChargeB(
    response: Response,
    id: any,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    if (bodys?.tariff_type_charge_id !== 2) {
      throw new Error('Error tariff_type_charge_id.');
    }
    const resData: any = await this.tariffService.chargeView(
      { id: Number(id) },
      userId,
    );
    const dataUse = resData?.[0] || [];
    const month_year_charge = dataUse?.tariff_charge?.tariff?.month_year_charge;
    const YYYYMM01 = getTodayNowAdd7(month_year_charge).format('YYYY-MM-01');
    const dayArrs = this.monthDateArray(YYYYMM01);
    // ["Gas Day"]: e,
    // ["Daily Allocated Exit Value (MMBTU)"]: findData?.totalNotRound || ""
    // const resultsData = [...results, {
    //   ["Gas Day"]: "total",
    //   ["Daily Allocated Exit Value (MMBTU)"]: results?.filter((f: any) => f?.["Daily Allocated Exit Value (MMBTU)"] !== "")?.reduce(
    //     (accumulator, currentValue) => accumulator + Number(currentValue?.["Daily Allocated Exit Value (MMBTU)"]),
    //     0,
    //   ).toFixed(3) || ""
    // }]
    console.log('---- old');
    console.log('dataUse : ', dataUse);
    // console.log('dayArrs : ', dayArrs);
    const results = dayArrs?.map((e: any) => {
      const findData = dataUse?.data?.day?.find((f: any) => f?.gas_day === e) || null
      return {
        ["Gas Day"]: e,
        ["Daily Allocated Exit Value (MMBTU)"]: findData?.totalNotRound || ""
      }
    })
    const resultsData = [...results, {
      ["Gas Day"]: "total",
      ["Daily Allocated Exit Value (MMBTU)"]: results?.filter((f: any) => f?.["Daily Allocated Exit Value (MMBTU)"] !== "")?.reduce(
        (accumulator, currentValue) => accumulator + Number(currentValue?.["Daily Allocated Exit Value (MMBTU)"]),
        0,
      ).toFixed(3) || ""
    }]

    // console.log('resultsData : ', resultsData);

    // const formateData = await resultsData.map((e: any) => {

    //   let setData = {
    //     ['Gas Day']: e['Gas Day'] || '',
    //     ['Daily Allocated Exit Value (MMBTU)']: e['Daily Allocated Exit Value (MMBTU)'] || '',
    //   };
    //   let filteredData = Object.keys(setData).reduce((obj, key) => {
    //     obj[key] = setData[key];
    //     return obj;
    //   }, {});

    //   return filteredData;
    // });

    // // ---------------- manage table excel

    // // sort header
    // // const filterHeader = filter || [];
    // const filterHeader = [
    //   "Gas Day",
    //   "Daily Allocated Exit Value (MMBTU)",
    // ];

    // // header color
    // const headerColorMap = {
    //   "Gas Day": '1573A1', // #1573A1
    //   "Daily Allocated Exit Value (MMBTU)": '1573A1', // #1573A1
    // };

    // function generateCellHighlightMapMultiple(
    //   keys: string[],
    //   data: any[],
    //   color: string,
    // ): Record<string, Record<number, string>> {
    //   const result: Record<string, Record<number, string>> = {};
    //   for (const key of keys) {
    //     result[key] = {};
    //     for (let i = 0; i < data.length; i++) {
    //       if (data.length - 1 === i) {
    //         result[key][i] = "ffffdf"; // #ffffdf
    //       }
    //     }
    //   }

    //   return result;
    // }

    // const cellHighlightMap = generateCellHighlightMapMultiple(
    //   filterHeader,
    //   formateData,
    //   'EAF5F8',
    // );

    // // addsection
    // const result = this.filterNestedData(formateData, filterHeader);

    // // เพิ่ม header


    // return await this.exportDataToExcelWithMultiLevelHeaderNew(
    //   result,
    //   response,
    //   'Commodity Charge B',
    //   true,
    //   headerColorMap,
    //   cellHighlightMap,
    // );

    console.log('new');

    // Number(e['capacityMMBTUValue']?.trim()?.replace(/,/g, '')) || 0;


    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');

    /**
     * วาด 1 ชุด (Actual / Booking / Overuse)
     * rows: [{ area: string, values: number[] }] // values ยาวเท่าจำนวนวันที่
     * opts: { title: string; band: string; bodyShade?: string }
     * return: แถวถัดไปของชุดนี้
     */

    function addSectionH(
      ws: ExcelJS.Worksheet,
      startRow: number,
    ) {
      const row = ws.getRow(startRow);
      const h1 = row.getCell(1);
      h1.value = "Gas Day";
      h1.alignment = { horizontal: 'center' };
      h1.border = {
        top: { style: 'thin' as const },
        left: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        right: { style: 'thin' as const },
      }
      h1.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
      ws.mergeCells('B6:G6');
      const h2 = row.getCell(2);
      h2.value = "Daily Allocated Exit Value (MMBTU)";
      h2.alignment = { horizontal: 'center' };
      h2.border = {
        top: { style: 'thin' as const },
        left: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        right: { style: 'thin' as const },
      }
      h2.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };

      return 1

    }

    function addSection(
      ws: ExcelJS.Worksheet,
      startRow: number,
      dates: any[],
    ) {

      dates.forEach((rowData: any, index) => {
        const row = ws.getRow(index + startRow + 6);

        // FID (Column A)
        const fidCell = row.getCell(1);
        fidCell.value = rowData?.["Gas Day"];
        fidCell.alignment = { horizontal: 'left' };
        fidCell.border = {
          top: { style: 'thin' as const },
          left: { style: 'thin' as const },
          bottom: { style: 'thin' as const },
          right: { style: 'thin' as const },
        }

        // NAME (Column B)
        ws.mergeCells(`B${index + startRow + 6}:G${index + startRow + 6}`);
        const nameCell = row.getCell(2);
        nameCell.value = rowData?.["Daily Allocated Exit Value (MMBTU)"];
        nameCell.alignment = { horizontal: 'right' };
        nameCell.border = {
          top: { style: 'thin' as const },
          left: { style: 'thin' as const },
          bottom: { style: 'thin' as const },
          right: { style: 'thin' as const },
        }

        ws.columns = [
          { width: 15 }, // Gas Day
        ];

        row.height = 20;
      });

      return 1

    }

    function addHeaderSection(ws: ExcelJS.Worksheet, params: any) {
      // Company Name
      ws.mergeCells('A1:G1');
      const companyCell = ws.getCell('A1');
      companyCell.value = params?.companyName || "PTT Public Company Limited";
      companyCell.font = { size: 14, bold: true };
      companyCell.alignment = { horizontal: 'left' };

      ws.mergeCells('A2:G2');
      const overuseCR = ws.getCell('A2');
      overuseCR.value = `Over-Use Capacity Report : ${params?.shipperName || ""}`;
      overuseCR.font = { size: 12, bold: true };
      overuseCR.alignment = { horizontal: 'left' };
      companyCell.alignment = { horizontal: 'left' };

      ws.mergeCells('A3:G3');
      const titleCell = ws.getCell('A3');
      titleCell.value = `Contract no. : ${params?.contract || ""}`;
      titleCell.font = { size: 12, bold: true };
      titleCell.alignment = { horizontal: 'left' };

      // Period
      ws.mergeCells('A4:G4');
      const periodCell = ws.getCell('A4');
      periodCell.value = `Month ${params?.month || ""} Year ${params?.year || ""}`;
      periodCell.font = { size: 12, bold: true };
      periodCell.alignment = { horizontal: 'left' };

      // Empty row
      ws.getRow(5).height = 20;

      // return r + 1; // เว้น 1 แถวก่อนชุดถัดไป
      return 6; // เว้น 1 แถวก่อนชุดถัดไป
    }

    // // ล็อคซ้าย 3 คอลัมน์ (A:B:C)
    // ws.views = [{ state: 'frozen', xSplit: 3 }];

    let row = 1;

    const dataHead = dataUse?.tariff_charge

    row = addHeaderSection(ws, {
      shipperName: dataHead?.tariff?.shipper?.name,
      month: getTodayNowAdd7(dataHead?.month_year_charge).format("MMM"),
      year: getTodayNowAdd7(dataHead?.month_year_charge).format("YYYY"),
      contract: dataHead?.contract_code?.contract_code,
    })

    row = addSectionH(ws, row);
    row = addSection(ws, row, resultsData);

    const fileName = `Commodity Charge B.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    await wb.xlsx.write(response); // เขียนเป็นสตรีมลง response
    response.end();


    // ----


  }


  // view tariff-charge-report Imbalances Penalty Charge (Positive) & (Negative)
  // ...

  // view tariff-charge-report Capacity Overuse Charge (Entry) & (Exit)
  monthDateArray(yyyymm01: string): string[] {
    // รับได้ทั้งมีขีดและไม่มีขีด
    const cleaned = yyyymm01?.replace(/[^0-9]/g, ''); // "20250201"
    if (cleaned.length !== 8)
      throw new Error('รูปแบบวันที่ควรเป็น YYYYMMDD หรือ YYYY-MM-DD');

    const isoStart = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    let start = getTodayNowAdd7(isoStart);
    if (!start.isValid()) throw new Error('วันที่ไม่ถูกต้อง');

    // เผื่อผู้ใช้ส่งมาไม่ใช่วันที่ 01 ก็จะอิงวันแรกของเดือนให้
    start = start.startOf('month');

    const days = start.daysInMonth();
    return Array.from({ length: days }, (_, i) =>
      start.add(i, 'day').format('YYYY-MM-DD'),
    );
  }

  async tariffChargeReportCapacityOveruseChargeEntryExit(
    response: Response,
    id: any,
    payload: any,
    userId: any,
  ) {
    const { bodys, filter } = payload || {};
    if (bodys?.tariff_type_charge_id !== 5 && bodys?.tariff_type_charge_id !== 6) {
      throw new Error('Error tariff_type_charge_id.');
    }
    const resData: any = await this.tariffService.chargeView(
      { id: Number(id) },
      userId,
    );
    const dataUse = resData?.[0] || [];
    const month_year_charge = dataUse?.tariff_charge?.tariff?.month_year_charge;
    const YYYYMM01 = getTodayNowAdd7(month_year_charge).format('YYYY-MM-01');
    const dayArrs = this.monthDateArray(YYYYMM01);
    // Number(e['capacityMMBTUValue']?.trim()?.replace(/,/g, '')) || 0;
    const fnMapData = (keys: any, text: any) => {
      const results = dataUse?.data?.data?.map((fm: any) => {
        const dayMo = dayArrs?.map((dm: any, im: any) => {
          const find = fm?.tempDateArr?.find((f: any) => f?.gas_day === dm)?.[
            keys
          ];
          return {
            [dm]: find || '',
          };
        });

        return {
          key: text,
          ['Area']: fm?.area || '',
          ...dayMo,
        };
      });
      return results;
    };
    const allocationData = fnMapData('allocatedValue', 'Actual');
    const contractCapacityData = fnMapData('contractCapacity', 'Booking');
    const overusageData = fnMapData('overusage', 'Overuse');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');

    // 
    // ===== helpers =====
    const ARGB = (hex: string) => `FF${hex?.replace('#', '').toUpperCase()}`; // to ARGB
    const NUM_FMT = '#,##0.000';

    function solid(cell: ExcelJS.Cell, hex: string) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(hex) } };
    }
    function borderAll(cell: ExcelJS.Cell) {
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    }
    function setHdrStyle(cell: ExcelJS.Cell) {
      cell.font = { bold: true, color: { argb: ARGB('#FFFFFF') } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
    function dmy(d: Date) {
      const dd = d.getDate();
      const mm = d.getMonth() + 1;
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
    /**
     * วาด 1 ชุด (Actual / Booking / Overuse)
     * rows: [{ area: string, values: number[] }] // values ยาวเท่าจำนวนวันที่
     * opts: { title: string; band: string; bodyShade?: string }
     * return: แถวถัดไปของชุดนี้
     */

    function addSection(
      ws: ExcelJS.Worksheet,
      startRow: number,
      dates: Date[],
      rows: { area: string; values: number[] }[],
      opts: {
        title: string;
        band: string;               // น้ำเงินเข้มของหัว
        bodyShade?: string;         // สีพื้นบอดี้ (เช่น Overuse)
        titleBg?: string;           // พื้นของป้ายเหลือง (จริงๆพื้นน้ำเงิน)
        titleFg?: string;           // สีอักษรป้ายเหลือง
        leftTagText?: string;       // ข้อความป้ายเขียว
        leftTagBg?: string;         // พื้นป้ายเขียว
        leftTagFg?: string;         // สีอักษรป้ายเขียว
        trailing?: any;
      }
    ) {
      const COL_LABEL = 1;  // A
      const COL_AREA = 2;  // B
      const COL_TYPE = 3;  // C
      const COL_FIRST = 4;  // D
      const TRAIL_N = opts.trailing?.length ?? 0;

      let COL_LAST = COL_FIRST + dates.length - 1;

      if (opts?.title === "Overuse") {
        COL_LAST += 1
      }

      // --- แถวป้ายเหลือง (อยู่แถวเดียวกับหัวบน)
      const rTitle = startRow;
      const cTitle = ws.getCell(rTitle, COL_LABEL);
      cTitle.value = opts.title;
      solid(cTitle, opts.titleBg ?? '#FFE600');       // พื้นเหลือง
      cTitle.font = { bold: true, size: 12, color: { argb: ARGB(opts.titleFg ?? '#000000') } };
      borderAll(cTitle);                               // ขอบชัดๆ (ออปชัน)
      cTitle.alignment = { vertical: 'middle', horizontal: 'left' };
      ws.getColumn(COL_LABEL).width = 12;

      // --- หัว 2 ชั้นเริ่มทันที (ไม่มีแถวว่าง)
      const rNum = rTitle;        // เลขลำดับอยู่แถวเดียวกับป้ายเหลือง
      const rDate = rTitle + 1;    // วันที่อยู่แถวเดียวกับป้ายเขียว

      // ป้ายเขียวอยู่ A ของแถวล่าง (ไม่ merge 2 แถว)
      if (opts.leftTagText) {
        const tag = ws.getCell(rDate, COL_LABEL);
        tag.value = opts.leftTagText;
        tag.alignment = { vertical: 'middle', horizontal: 'left' };
        tag.font = { bold: true, color: { argb: ARGB(opts.leftTagFg ?? '#000000') } };
        solid(tag, opts.leftTagBg ?? '#A6CE39');
        borderAll(tag);
      }

      // Area/Type merge 2 แถว
      ws.mergeCells(rNum, COL_AREA, rDate, COL_AREA);
      ws.mergeCells(rNum, COL_TYPE, rDate, COL_TYPE);
      ws.getCell(rNum, COL_AREA).value = 'Area';
      ws.getCell(rNum, COL_TYPE).value = 'Type';

      // แถบหัวสีน้ำเงิน 2 แถว (B..last)
      for (let c = COL_AREA; c <= COL_LAST; c++) {
        const c1 = ws.getCell(rNum, c);
        const c2 = ws.getCell(rDate, c);

        solid(c1, opts.band); solid(c2, opts.band);
        setHdrStyle(c1); setHdrStyle(c2);
        borderAll(c1); borderAll(c2);
      }

      // ลำดับ + วันที่
      dates.forEach((d, i) => {
        ws.getCell(rNum, COL_FIRST + i).value = i + 1;
        ws.getCell(rDate, COL_FIRST + i).value = dmy(d);
      });

      // หัวของคอลัมน์ต่อท้าย (ถ้ามี)
      if (TRAIL_N) {
        opts.trailing!.forEach((t, j) => {
          const col = COL_FIRST + dates.length + j;
          ws.getCell(rNum, col).value = t.top ?? '';
          ws.getCell(rDate, col).value = t.bottom ?? '';
          if (t.width) ws.getColumn(col).width = t.width;
        });
      }

      // --- บอดี้
      let r = rDate + 1;
      rows.forEach((row, idx) => {
        const cA = ws.getCell(r, COL_AREA);
        const cT = ws.getCell(r, COL_TYPE);
        cA.value = row.area; cT.value = 'Total';
        cA.alignment = { vertical: 'middle', horizontal: 'left' };
        cT.alignment = { vertical: 'middle', horizontal: 'center' };
        borderAll(cA); borderAll(cT);
        console.log('dates : ', dates);
        dates.forEach((_, i) => {
          const cell = ws.getCell(r, COL_FIRST + i);

          cell.value = row.values[i] ?? 0;

          cell.numFmt = NUM_FMT;
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          borderAll(cell);
        });

        // คอลัมน์ต่อท้าย (เช่น calc)
        if (TRAIL_N) {
          opts.trailing!.forEach((t, j) => {
            const col = COL_FIRST + dates.length + j;
            const cell = ws.getCell(r, col);
            const v = (typeof t.value === 'function')
              ? t.value({
                ws, excelRow: r,
                firstDateCol: COL_FIRST,
                lastDateCol: COL_FIRST + dates.length - 1,
                row, rowIndex: idx
              })
              : (t.value ?? '');
            cell.value = v;
            if (t.numFmt) cell.numFmt = t.numFmt;
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            borderAll(cell);
          });
        }

        if (opts.bodyShade) {
          for (let c = COL_LABEL; c <= COL_LAST; c++) solid(ws.getCell(r, c), opts.bodyShade);
        } else if (idx % 2 === 1) {
          for (let c = COL_LABEL; c <= COL_LAST; c++) {
            ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB('#EFF4FA') } };
          }
        }
        r++;
      });

      // Overuse

      // ความกว้าง
      ws.getColumn(COL_AREA).width = 8;
      ws.getColumn(COL_TYPE).width = 8;
      for (let c = COL_FIRST; c <= COL_LAST; c++) ws.getColumn(c).width = 12;

      return r + 1; // เว้น 1 แถวก่อนชุดถัดไป
    }

    // -----

    function addHeaderSection(ws: ExcelJS.Worksheet, params: any) {
      // Company Name
      ws.mergeCells('A1:M1');
      const companyCell = ws.getCell('A1');
      companyCell.value = params?.companyName || "PTT Public Company Limited";
      companyCell.font = { size: 14, bold: true };
      companyCell.alignment = { horizontal: 'left' };

      ws.mergeCells('A2:M2');
      const overuseCR = ws.getCell('A2');
      overuseCR.value = `Over-Use Capacity Report : ${params?.shipperName || ""}`;
      overuseCR.font = { size: 12, bold: true };
      overuseCR.alignment = { horizontal: 'left' };
      companyCell.alignment = { horizontal: 'left' };

      ws.mergeCells('A3:M3');
      const titleCell = ws.getCell('A3');
      titleCell.value = `Contract no. : ${params?.contract || ""}`;
      titleCell.font = { size: 12, bold: true };
      titleCell.alignment = { horizontal: 'left' };

      // Period
      ws.mergeCells('A4:M4');
      const periodCell = ws.getCell('A4');
      periodCell.value = `Month ${params?.month || ""} Year ${params?.year || ""}`;
      periodCell.font = { size: 12, bold: true };
      periodCell.alignment = { horizontal: 'left' };

      // Empty row
      ws.getRow(5).height = 20;

      // return r + 1; // เว้น 1 แถวก่อนชุดถัดไป
      return 6; // เว้น 1 แถวก่อนชุดถัดไป
    }


    function addLicenSection(ws: ExcelJS.Worksheet, params: any, data: any[]) {
      const startRow = 6; // Adjusted for new rows (Total MMBTU + threshold row)

      // // Value legend with red text
      // const valueRow = ws.getRow(startRow);
      // const valueCell = valueRow.getCell(1);
      // valueCell.value = 'Value';
      // valueCell.font = { size: 10, color: { argb: 'FFFF0000' } }; // Red text
      // valueCell.alignment = { horizontal: 'center' };

      // // const valuegRow = ws.getRow(startRow);
      // const valuegCell = valueRow.getCell(2);
      // valuegCell.value = '=';
      // valuegCell.alignment = { horizontal: 'center' };

      // // const valuegRow = ws.getRow(startRow);
      // const valueRemarkCell = valueRow.getCell(3);
      // valueRemarkCell.value = 'ปริมาณความไม่สมดุลทางบวกและทางลบเกินเกณฑ์ ±5%';


      // Reported By sections
      const reportedByStartRow = startRow;

      // Left side - Reported By
      const reportedByRow = ws.getRow(reportedByStartRow);
      const reportedByCell = reportedByRow.getCell(1);
      reportedByCell.value = 'Reported By ___________________________________________';
      reportedByCell.font = { size: 10, bold: true };

      const reportedByNameRow = ws.getRow(reportedByStartRow + 1);
      const reportedByNameCell = reportedByNameRow.getCell(1);
      reportedByNameCell.value = `(${params.reportedBy.name})`;
      reportedByNameCell.font = { size: 10 };

      const reportedByPositionRow = ws.getRow(reportedByStartRow + 2);
      const reportedByPositionCell = reportedByPositionRow.getCell(1);
      reportedByPositionCell.value = `${params.reportedBy.position} of ${params.reportedBy.division}`;
      reportedByPositionCell.font = { size: 10 };

      // const reportedByDivisionRow = ws.getRow(reportedByStartRow + 3);
      // const reportedByDivisionCell = reportedByDivisionRow.getCell(1);
      // reportedByDivisionCell.value = params.reportedBy.division;
      // reportedByDivisionCell.font = { size: 10 };

      // Right side - Manager
      const managerRow = ws.getRow(reportedByStartRow);
      const managerCell = managerRow.getCell(7);
      managerCell.value = 'Approved By ___________________________________________';
      managerCell.font = { size: 10, bold: true };

      const managerNameRow = ws.getRow(reportedByStartRow + 1);
      const managerNameCell = managerNameRow.getCell(7);
      managerNameCell.value = `(${params.manager.name})`;
      managerNameCell.font = { size: 10 };

      const managerPositionRow = ws.getRow(reportedByStartRow + 2);
      const managerPositionCell = managerPositionRow.getCell(7);
      managerPositionCell.value = `${params.manager.position} of ${params.manager.division}`;
      managerPositionCell.font = { size: 10 };

      // const managerDivisionRow = ws.getRow(reportedByStartRow + 3);
      // const managerDivisionCell = managerDivisionRow.getCell(7);
      // managerDivisionCell.value = params.manager.division;
      // managerDivisionCell.font = { size: 10 };

      return 11; // เว้น 1 แถวก่อนชุดถัดไป
    }


    // ===== ใช้งานจริง =====

    function toLocalDateFromYYYYMMDD(s: string): Date {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, (m ?? 1) - 1, d ?? 1);
    }
    // const dates = genDates('2024-04-01', '2024-04-10');
    const dates: Date[] = dayArrs.map(toLocalDateFromYYYYMMDD);


    const actualRows = allocationData?.map((e: any) => {
      return { area: e?.Area, values: dates.map((_, i) => Object.values(e[i])?.[0]) }
    });
    const bookingRows = contractCapacityData?.map((e: any) => {
      return { area: e?.Area, values: dates.map((_, i) => Object.values(e[i])?.[0]) }
    });
    const overuseRows = overusageData?.map((e: any) => {
      return { area: e?.Area, values: dates.map((_, i) => Object.values(e[i])?.[0]) }
    });

    // ล็อคซ้าย 3 คอลัมน์ (A:B:C)
    ws.views = [{ state: 'frozen', xSplit: 3 }];

    // dates, actualRows, bookingRows, overuseRows เหมือนเดิม
    let row = 1;
    const navy = '#163B74'; // น้ำเงินเข้มแบบภาพ

    const dataHead = dataUse?.tariff_charge

    // console.log('dataHead : ', dataHead);
    row = addHeaderSection(ws, {
      shipperName: dataHead?.tariff?.shipper?.name,
      month: getTodayNowAdd7(dataHead?.month_year_charge).format("MMM"),
      year: getTodayNowAdd7(dataHead?.month_year_charge).format("YYYY"),
      contract: dataHead?.contract_code?.contract_code,
    })

    row = addLicenSection(ws, {
      reportedBy: {
        name: 'Ms.Wipada Yenyin',
        position: 'Senior Engineer',
        division: 'Transmission Contracts & Regulatory Management Division',
      },
      manager: {
        name: 'Ms. Tanatchaporn',
        position: 'Manager of',
        division: 'Transmission Contracts & Regulatory Management Division',
      },
    }, [])

    row = addSection(ws, row, dates, actualRows, {
      title: 'Actual', band: navy, titleBg: '#FFE600', titleFg: '#000000',
      leftTagText: 'MMBTUD', leftTagBg: '#A6CE39', leftTagFg: '#000000'
    });
    row = addSection(ws, row, dates, bookingRows, {
      title: 'Booking', band: navy, titleBg: '#FFE600', titleFg: '#000000',
      leftTagText: 'MMBTUD', leftTagBg: '#A6CE39', leftTagFg: '#000000'
    });

    row = addSection(ws, row, dates, overuseRows, {
      title: 'Overuse', band: navy, titleBg: '#FFE600', titleFg: '#000000',
      bodyShade: '#F2E6E0',
      leftTagText: 'MMBTUD', leftTagBg: '#A6CE39', leftTagFg: '#000000',
      trailing: [{
        top: 'Total', bottom: '', width: 12, numFmt: NUM_FMT,
        value: ({ ws, excelRow, firstDateCol, lastDateCol }) => ({
          formula: `SUM(${ws.getCell(excelRow, firstDateCol).address}:${ws.getCell(excelRow, lastDateCol).address})`
        })
      }]
    });
    // console.log('overuseRows : ', overuseRows);
    const footerCalc = overuseRows?.map((c: any, i: any) => {
      const calc = c?.values?.reduce(
        (accumulator, currentValue) => accumulator + (currentValue && Number(currentValue) || 0),
        0,
      )
      // ปัดเศษ 3 ตำแหน่ง
      const fCalc = Math.round(calc * 1000) / 1000
      return fCalc
    })?.reduce(
      (accumulator, currentValue) => accumulator + (currentValue && Number(currentValue) || 0),
      0,
    )
    const roundfooterCalc = Math.round(footerCalc)
    // console.log('footerCalc : ', footerCalc);
    // console.log('roundfooterCalc : ', roundfooterCalc);
    // 1. sum overuse entry
    // 2. sum overuse exit
    // 3. sum overuse entry+exit and round

    // รวมปริมาณการใช้ความสามารถในการให้บริการเกินกำหนด ณ กลุ่มของจุดส่งเข้า (MMBTU)
    // รวมปริมาณการใช้ความสามารถในการให้บริการเกินกำหนด ณ กลุ่มของจุดจ่ายออก (MMBTU)
    // สรุปปริมาณการใช้ความสามารถในการให้บริการเกินกำหนดประจำเดือน

    // addFooterSection

    function addFooterSection(ws: ExcelJS.Worksheet) {
      const startRow = 19 + actualRows.length + bookingRows.length + overuseRows.length; // Adjusted for new rows (Total MMBTU + threshold row)
      console.log('startRow : ', startRow);
      // Reported By sections
      const footerStart = startRow;

      // กำหนดช่วงคอลัมน์ที่ต้องการ merge
      const LABEL_START_COL = 2;                 // คอลัมน์ C
      const LABEL_END_COL = dates.length + 3;  // คอลัมน์สุดท้ายของวันที่ (lastDateCol)
      const VALUE_COL = LABEL_END_COL + 1; // คอลัมน์ตัวเลขรวม
      ws.mergeCells(startRow, LABEL_START_COL, startRow, LABEL_END_COL);

      // Left side - Reported By
      const overuserCalc = ws.getRow(footerStart);
      const txtoveruseByCell = overuserCalc.getCell(dates.length + 3);
      txtoveruseByCell.value = `รวมปริมาณการใช้ความสามารถในการให้บริการเกินกำหนด`;
      solid(txtoveruseByCell, '#e1eada');
      txtoveruseByCell.font = { bold: true, color: { argb: ARGB('#000000') } };
      txtoveruseByCell.alignment = { vertical: 'middle', horizontal: 'right' };
      const overuseByCell = overuserCalc.getCell(dates.length + 4);
      overuseByCell.value = footerCalc;
      solid(overuseByCell, '#e0ead9');
      overuseByCell.font = { bold: true, color: { argb: ARGB('#000000') } };
      overuseByCell.alignment = { vertical: 'middle', horizontal: 'right' };

      const r2 = startRow + 1;
      ws.mergeCells(r2, LABEL_START_COL, r2, LABEL_END_COL);
      const totalCalc = ws.getRow(footerStart + 1);
      const txttotalByCell = totalCalc.getCell(dates.length + 3);
      txttotalByCell.value = `สรุปปริมาณการใช้ความสามารถในการให้บริการเกินกำหนดประจำเดือน`;
      solid(txttotalByCell, '#fef0c8');
      txttotalByCell.font = { bold: true, color: { argb: ARGB('#000000') } };
      txttotalByCell.alignment = { vertical: 'middle', horizontal: 'right' };
      const totalByCell = totalCalc.getCell(dates.length + 4);
      totalByCell.value = roundfooterCalc;
      solid(totalByCell, '#fdd764');
      totalByCell.font = { bold: true, color: { argb: ARGB('#000000') } };
      totalByCell.alignment = { vertical: 'middle', horizontal: 'right' };

      return 1; // เว้น 1 แถวก่อนชุดถัดไป
    }

    row = addFooterSection(ws)





    const fileName = `${dayjs().format('YYYY-MM-DD_HH-mm')}_Tariff Charge Report / CapacityOveruseCharge${bodys?.tariff_type_charge_id === 5 ? "Entry" : "Exit"}_report.xlsx`;

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    await wb.xlsx.write(response); // เขียนเป็นสตรีมลง response
    response.end();
  }

}
