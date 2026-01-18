import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getTodayNowDDMMYYYYDfault, getTodayEndDDMMYYYYDfaultAdd7, getTodayStartDDMMYYYYDfaultAdd7 } from '../../common/utils/date.util';

export interface DataProcessingResult {
  startDateExConv: any;
  renom: any;
  getsValue: any[];
  getsValueNotMatch: any[];
  getsValuePark: any[];
  getsValueSheet2: any[];
  caseData: any;
  informationData: any;
  fullDataRow: any[];
  flagEmtry: boolean;
  // overuseQuantity: boolean;
  // overMaximumHourCapacityRight: boolean;
  nominationPoint: any[];
  nonTpa: any[];
  conceptPoint: any[];
  // isEqualSheet2: boolean;
}

@Injectable()
export class DataProcessingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * STEP 17-22: DATA PROCESSING SETUP AND VALIDATION
   * ตั้งค่าการประมวลผลข้อมูลและตรวจสอบ nomination points
   * 
   * @param startDateEx - วันที่เริ่มต้นจากไฟล์
   * @param todayStart - วันที่เริ่มต้น
   * @param todayEnd - วันที่สิ้นสุด
   * @param sheet2 - ข้อมูล quality sheet
   * @returns DataProcessingResult - ผลลัพธ์การประมวลผลข้อมูล
   */
  async executeDataProcessing(
    startDateEx: string,
    todayStart: Date,
    todayEnd: Date,
    sheet2: any
  ): Promise<DataProcessingResult> {
    try {

      // ===== STEP 17: DATA PROCESSING SETUP =====
      const { startDateExConv, renom, getsValue, getsValueNotMatch, getsValuePark, getsValueSheet2, caseData, informationData, fullDataRow, flagEmtry } = this.setupDataProcessing(startDateEx);

      // // ===== STEP 18: VALIDATION FLAGS ===== //
      // const { overuseQuantity, overMaximumHourCapacityRight } = this.setupValidationFlags();

      // ===== STEP 19: NOMINATION POINT VALIDATION =====
      const nominationPoint = await this.validateNominationPoints(startDateEx);

      // ===== STEP 20: NON-TPA POINT VALIDATION =====
      const nonTpa = await this.validateNonTpaPoints(todayStart, todayEnd, startDateEx);

      // ===== STEP 21: CONCEPT POINT VALIDATION =====
      const conceptPoint = await this.validateConceptPoints(startDateEx);

      // // ===== STEP 22: QUALITY SHEET VALIDATION ===== //
      // const isEqualSheet2 = this.validateQualitySheet(sheet2);

      console.log('STEP 17-22: DATA PROCESSING SETUP AND VALIDATION completed successfully');

      return {
        startDateExConv,
        renom,
        getsValue,
        getsValueNotMatch,
        getsValuePark,
        getsValueSheet2,
        caseData,
        informationData,
        fullDataRow,
        flagEmtry,
        // overuseQuantity,
        // overMaximumHourCapacityRight,
        nominationPoint,
        nonTpa,
        conceptPoint,
        // isEqualSheet2
      };
    } catch (error) {
      console.error('Error in STEP 17-22: DATA PROCESSING SETUP AND VALIDATION:', error);
      throw error;
    }
  }

  /**
   * STEP 17: DATA PROCESSING SETUP
   * ตั้งค่าการประมวลผลข้อมูล
   * 
   * @param startDateEx - วันที่เริ่มต้นจากไฟล์
   * @returns Object containing processing setup data
   */
  private setupDataProcessing(startDateEx: string) {
    // Convert start date to proper format for processing
    const startDateExConv = getTodayNowDDMMYYYYDfault(startDateEx);
    // Initialize variables for data processing
    const renom = null; // Renomination flag
    const getsValue = []; // Valid data values
    const getsValueNotMatch = []; // Data that doesn't match validation
    const getsValuePark = []; // Park/unpark data
    const getsValueSheet2 = []; // Quality sheet data
    const caseData = {
      columnType: [],
      columnParkUnparkinstructedFlows: [],
      columnWHV: [],
      columnPointId: [],
      columnPointIdConcept: [],
      columnOther: [],
    };
    const informationData = {
      columnType: [],
      columnParkUnparkinstructedFlows: [],
      columnWHV: [],
      columnPointId: [],
      columnPointIdConcept: [],
      columnOther: [],
    };
    const fullDataRow = []; // Complete data rows
    const flagEmtry = true; // Flag to check if file has any valid data

    console.log('STEP 17: Data processing setup completed');
    return {
      startDateExConv,
      renom,
      getsValue,
      getsValueNotMatch,
      getsValuePark,
      getsValueSheet2,
      caseData,
      informationData,
      fullDataRow,
      flagEmtry
    };
  }

  /**
   * STEP 18: VALIDATION FLAGS
   * ตั้งค่า flag การตรวจสอบ
   * 
   * @returns Object containing validation flags
   */
  private setupValidationFlags() {
    const overuseQuantity = false; // Flag for overuse quantity validation
    const overMaximumHourCapacityRight = false; // Flag for over maximum hour capacity validation

    console.log('STEP 18: Validation flags setup completed');
    return {
      overuseQuantity,
      overMaximumHourCapacityRight
    };
  }

  /**
   * STEP 19: NOMINATION POINT VALIDATION
   * ตรวจสอบ nomination point
   * 
   * @param startDateEx - วันที่เริ่มต้นจากไฟล์
   * @returns Array of nomination points
   */
  private async validateNominationPoints(startDateEx: string) {
    // Get all active nomination points for the specified date range
    const nominationPoint = await this.prisma.nomination_point.findMany({
      where: {
        AND: [
          {
            start_date: {
              lte: getTodayEndDDMMYYYYDfaultAdd7(startDateEx).toDate(), // Point start date must be before or equal to file end date
            },
          },
          {
            OR: [
              { end_date: null }, // If end_date is null (no end date)
              { end_date: { gt: getTodayStartDDMMYYYYDfaultAdd7(startDateEx).toDate() } }, // If end_date exists, must be after file start date
            ],
          },
        ],
      },
      orderBy: {
        end_date: "desc" // Order by end date descending to get latest points first
      },
      include: {
        contract_point_list: {
          include: {
            area: true,    // Include area information
            zone: true,    // Include zone information
            entry_exit: true, // Include entry/exit information
          }
        },
        area: true,        // Include area information
        zone: true,        // Include zone information
        entry_exit: true,  // Include entry/exit information
      },
    });

    console.log('STEP 19: Nomination point validation completed');
    console.log('nominationPoint count:', nominationPoint.length);
    return nominationPoint;
  }

  /**
   * STEP 20: NON-TPA POINT VALIDATION
   * ตรวจสอบ non-TPA point
   * 
   * @param todayStart - วันที่เริ่มต้น
   * @param todayEnd - วันที่สิ้นสุด
   * @returns Array of non-TPA points
   */
  private async validateNonTpaPoints(todayStart: Date, todayEnd: Date, startDateEx: string) {
    // Get all active non-TPA points for the current date range
    const nonTpa = await this.prisma.non_tpa_point.findMany({
      where: {
        AND: [
          {
            start_date: {
              lte: getTodayEndDDMMYYYYDfaultAdd7(startDateEx).toDate(), 
            },
          },
          {
            OR: [
              { end_date: null },
              { end_date: { gt: getTodayStartDDMMYYYYDfaultAdd7(startDateEx).toDate() } }, 
            ],
          },
        ],
        // AND: [
        //   {
        //     start_date: {
        //       lte: todayEnd, // Point start date must be before or equal to today end
        //     },
        //   },
        //   {
        //     OR: [
        //       { end_date: null }, // If end_date is null (no end date)
        //       { end_date: { gte: todayStart } }, // If end_date exists, must be after or equal to today start
        //     ],
        //   },
        // ],
      },
      include: {
        nomination_point: {
          include: {
            contract_point_list: {
              include: {
                area: true,    // Include area information
                zone: true,    // Include zone information
                entry_exit: true, // Include entry/exit information
              }
            },
            area: true,        // Include area information
            zone: true,        // Include zone information
            entry_exit: true,  // Include entry/exit information
          }
        },
      },
    });

    console.log('STEP 20: Non-TPA point validation completed');
    console.log('nonTpa count:', nonTpa.length);
    return nonTpa;
  }

  /**
   * STEP 21: CONCEPT POINT VALIDATION
   * ตรวจสอบ concept point
   * 
   * @param startDateEx - วันที่เริ่มต้นจากไฟล์
   * @returns Array of concept points
   */
  private async validateConceptPoints(startDateEx: string) {
    // Get all active concept points for the specified date range
    // console.log('startDateEx : ', startDateEx);
    // console.log(getTodayEndDDMMYYYYDfaultAdd7(startDateEx).toDate());
    
    const conceptPoint = await this.prisma.concept_point.findMany({
      where: {
        AND: [
          {
            start_date: {
              lte: getTodayEndDDMMYYYYDfaultAdd7(startDateEx).toDate(), // Point start date must be before or equal to file end date
            },
          },
          {
            OR: [
              { end_date: null }, // If end_date is null (no end date)
              { end_date: { gte: getTodayStartDDMMYYYYDfaultAdd7(startDateEx).toDate() } }, // If end_date exists, must be after or equal to file start date
            ],
          },
        ],
      },
      include: {
        limit_concept_point: {
          include: {
            group: true, // Include group information for concept point limits
          }
        },
        type_concept_point: true, // Include concept point type information
      },
    });

    console.log('STEP 21: Concept point validation completed');
    console.log('conceptPoint count:', conceptPoint.length);
    return conceptPoint;
  }

  /**
   * STEP 22: QUALITY SHEET VALIDATION
   * ตรวจสอบ quality sheet
   * 
   * @param sheet2 - ข้อมูล quality sheet
   * @returns Boolean indicating if quality sheet is valid
   * @throws HttpException if quality sheet is invalid
   */
  private validateQualitySheet(sheet2: any) {
    // Check if Quality sheet exists and has data
    const isEqualSheet2 = sheet2 && sheet2.data && sheet2.data.length > 0;

    if (!isEqualSheet2) {
      console.log('Quality sheet validation failed');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'File template does not match the required format.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    console.log('STEP 22: Quality sheet validation completed');
    return isEqualSheet2;
  }
}
