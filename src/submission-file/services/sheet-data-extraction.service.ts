import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getTodayEndAdd7, getTodayNowAdd7, getTodayNowDDMMYYYYDfaultAdd7, getTodayStartAdd7 } from '../../common/utils/date.util';

export interface SheetDataExtractionResult {
  sheet1: any; // Main nomination sheet (Daily or Weekly)
  sheet2: any; // Quality sheet
  sheet3: any; // Lists sheet
  shipper: any; // Validated shipper data
  shipperCompare: any; // Shipper for comparison (including inactive ones)
  contractCodeName: any; // Validated contract code data
  contractCodeNameCompare: any; // Contract code for comparison
  shipper_id: number;
  contract_code_id: number;
  startDateEx: string;
}

@Injectable()
export class SheetDataExtractionService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * STEP 3-6: EXTRACT SHEET DATA AND VALIDATE
   * ดึงข้อมูลจาก sheet ต่างๆ และตรวจสอบความถูกต้อง
   * 
   * @param findData - ข้อมูลจาก file ที่ parse แล้ว
   * @param checkType - ประเภทของ nomination (Daily/Weekly)
   * @returns SheetDataExtractionResult - ผลลัพธ์การดึงข้อมูลและตรวจสอบ
   */
  async executeSheetDataExtraction(
    findData: any[], 
    checkType: string
  ): Promise<SheetDataExtractionResult> {
    try {
      // ===== STEP 3: EXTRACT SHEET DATA =====
      // ดึงข้อมูลจาก sheet ต่างๆ
      const { sheet1, sheet2, sheet3 } = this.extractSheetData(findData, checkType);

      // ===== STEP 4: HEADER VALIDATION =====
      // ตรวจสอบ header ที่จำเป็น
      this.validateRequiredHeaders(sheet1);

      // ===== STEP 5: SHIPPER VALIDATION =====
      // ตรวจสอบข้อมูล shipper
      const { shipper, shipperCompare, } = await this.validateShipperData(sheet1);

      // ===== STEP 6: CONTRACT CODE VALIDATION =====
      // ตรวจสอบ contract code
      const { contractCodeName, contractCodeNameCompare } = await this.validateContractCode(sheet1);

      // Extract IDs and start date for further processing
      const shipper_id = shipper?.id;
      const contract_code_id = contractCodeName?.id;
      const startDateEx = sheet1?.data[1][2];

      console.log('STEP 3-6: SHEET DATA EXTRACTION completed successfully');
      console.log('shipper_id:', shipper_id);
      console.log('contract_code_id:', contract_code_id);
      console.log('startDateEx:', startDateEx);

      return {
        sheet1,
        sheet2,
        sheet3,
        shipper,
        shipperCompare,
        contractCodeName,
        contractCodeNameCompare,
        shipper_id,
        contract_code_id,
        startDateEx
      };
    } catch (error) {
      console.error('Error in STEP 3-6: SHEET DATA EXTRACTION:', error);
      throw error;
    }
  }

  /**
   * STEP 3: EXTRACT SHEET DATA
   * ดึงข้อมูลจาก sheet ต่างๆ
   * 
   * @param findData - ข้อมูลจาก file ที่ parse แล้ว
   * @param checkType - ประเภทของ nomination (Daily/Weekly)
   * @returns Object containing sheet1, sheet2, sheet3
   */
  private extractSheetData(findData: any[], checkType: string) {
    // Find the main nomination sheet (Daily or Weekly)
    const sheet1 = findData.find((f: any) => {
      return f?.sheet === checkType;
    });

    // Find the Quality sheet
    const sheet2 = findData.find((f: any) => {
      return f?.sheet === 'Quality';
    });

    // Find the Lists sheet
    const sheet3 = findData.find((f: any) => {
      return f?.sheet === 'Lists';
    });

    console.log('STEP 3: Sheet data extracted');
    console.log('sheet1 found:', !!sheet1);
    console.log('sheet2 found:', !!sheet2);
    console.log('sheet3 found:', !!sheet3);

    return { sheet1, sheet2, sheet3 };
  }

  /**
   * STEP 4: HEADER VALIDATION
   * ตรวจสอบ header ที่จำเป็น
   * 
   * @param sheet1 - Main nomination sheet
   * @throws HttpException if required headers are missing
   */
  private validateRequiredHeaders(sheet1: any) {
    // Validate required headers in the first row: ['SHIPPER ID', 'CONTRACT CODE', 'START DATE']
    if (sheet1?.data[0][0] !== 'SHIPPER ID') {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Header SHIPPER ID Missing.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (sheet1?.data[0][1] !== 'CONTRACT CODE') {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Header Contract Code is incorrect.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (sheet1?.data[0][2] !== 'START DATE') {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Header START DATE Missing.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    console.log('STEP 4: Header validation passed');
  }

  /**
   * STEP 5: SHIPPER VALIDATION
   * ตรวจสอบข้อมูล shipper
   * 
   * @param sheet1 - Main nomination sheet
   * @returns Object containing validated shipper data and comparison data
   * @throws HttpException if shipper is not found or invalid
   */
  private async validateShipperData(sheet1: any) {
    // Find active shipper with valid date range
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const shipper = await this.prisma.group.findFirst({
      where: {
        id_name: sheet1?.data[1][0],
        status: true,
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
    const shipperCompare = await this.prisma.group.findFirst({
      where: {
        id_name: sheet1?.data[1][0],
      },
    });
   

    console.log('STEP 5: Shipper validation passed');
    console.log('shipper:', shipper.id_name);

    return { shipper, shipperCompare };
  }

  /**
   * STEP 6: CONTRACT CODE VALIDATION
   * ตรวจสอบ contract code
   * 
   * @param sheet1 - Main nomination sheet
   * @returns Object containing contractCodeName and contractCodeNameCompare
   * @throws HttpException if contract code is not found or invalid
   */
  private async validateContractCode(sheet1: any) {
    // Find contract code with valid date range and approved status
    const contractCodeName = await this.prisma.contract_code.findFirst({
      where: {
        contract_code: sheet1?.data[1][1],
        AND: [
          {
            contract_start_date: {
              lte: getTodayNowDDMMYYYYDfaultAdd7(sheet1?.data[1][2]).toDate(), // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
            },
            contract_end_date: {
              gte: getTodayNowDDMMYYYYDfaultAdd7(sheet1?.data[1][2]).toDate(),
            },
          },
        ],
        status_capacity_request_management: {
          id: {
            in: [2, 5],
          },
        },
      },
      include: {
        group: true,
      },
    });
    // Find contract code for comparison (including non-approved ones)
    const contractCodeNameCompare = await this.prisma.contract_code.findFirst({
      where: {
        contract_code: sheet1?.data[1][1],
      },
    });




    if (!contractCodeName?.id && !!contractCodeNameCompare?.id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code is inactivated.',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else if (!contractCodeNameCompare?.id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code is incorrect.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // check terminate
    if (contractCodeName?.status_capacity_request_management_id === 5) {
      // if(getTodayNowAdd7(contractCodeName?.terminate_date).isSameOrBefore(getTodayNowAdd7())){
      if (getTodayNowAdd7(contractCodeName?.terminate_date).isBefore(getTodayNowDDMMYYYYDfaultAdd7(sheet1?.data[1][2]))) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Contract Code is inactivated.',
          },
          HttpStatus.BAD_REQUEST,
        )
      }
    }

    console.log('STEP 6: Contract code validation passed');
    console.log('contract_code:', contractCodeName.contract_code);

    return { contractCodeName, contractCodeNameCompare };
  }
}
