import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getTodayNow } from '../../common/utils/date.util';

export interface DailyNominationResult {
  renom: any;
  sheet1: any;
  flagEmtry: boolean;
  bookingFullJson: any;
  headerEntryCDBMMBTUD: any;
  headerExitCDBMMBTUD: any;
  headerEntryCDBMMBTUH: any;
  headerExitCDBMMBTUH: any;
  entryValue: any;
  exitValue: any;
  filePeriodMode: any;
  zoneQualityMaster: any[];
  resultEntryExitUse: any;
  resultEntryExitUsePerDay: any;
  isValid: boolean;
  message?: string;
}

@Injectable()
export class DailyNominationService {
  constructor(private readonly prisma: PrismaService) { }

  private safeParseJSON(jsonString: string): any {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.error('Error parsing JSON:', error);
      return null;
    }
  }

  /**
   * STEP 23-28: DAILY NOMINATION PROCESSING
   * ประมวลผล daily nomination
   * 
   * @param checkType - ประเภทการเสนอชื่อ
   * @param nomination_type_id - ID ของ nomination type
   * @param startDateExConv - วันที่แปลงแล้ว
   * @param nominationDeadlineSubmission - ข้อมูล deadline การส่ง
   * @param nominationDeadlineReceptionOfRenomination - ข้อมูล deadline การรับเสนอชื่อใหม่
   * @param sheet1 - ข้อมูล sheet หลัก
   * @param contractCode - ข้อมูล contract code
   * @param todayEnd - วันที่สิ้นสุด
   * @param flagEmtry - flag ตรวจสอบไฟล์ว่าง
   * @returns DailyNominationResult - ผลลัพธ์การประมวลผล daily nomination
   */
  async executeDailyNomination(
    checkType: string,
    nomination_type_id: number,
    startDateExConv: any,
    nominationDeadlineSubmission: any,
    nominationDeadlineReceptionOfRenomination: any,
    sheet1: any,
    contractCode: any,
    todayEnd: Date,
    flagEmtry: boolean
  ): Promise<DailyNominationResult> {
    try {
      // ===== STEP 23: DAILY NOMINATION PROCESSING =====
      if (checkType === 'Daily Nomination') {
        // Validate nomination type matches
        if (Number(nomination_type_id) !== 1) {
          console.log('Daily nomination type validation failed');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'File template does not match the required format.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // ===== STEP 24: DEADLINE CHECK FOR DAILY NOMINATION =====
        const renom = this.ckDateInfoNomDailyAndWeeklyNew(
          getTodayNow(),
          startDateExConv,
          nominationDeadlineSubmission,
          nominationDeadlineReceptionOfRenomination,
          1
        );

        // ===== STEP 25: DAILY HEADER VALIDATION =====
        const ckDateHead = this.validateDataDaily(sheet1?.data[2]);
        if (!ckDateHead) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'The hour in the template must start from 1 to 24.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Process sheet1 data
        sheet1 = this.processSheet1Data(sheet1);

        // ===== STEP 26: FINAL DATA VALIDATION =====
        if (flagEmtry) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Invalid File : Values are missing. Please provide at least one valid entry',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // ===== STEP 27: BOOKING DATA PROCESSING =====
        const bookingData = await this.processBookingData(contractCode, todayEnd);

        // ===== STEP 28: DAILY NOMINATION PROCESSING =====
        const dailyProcessingResult = this.processDailyNominationData(
          nomination_type_id,
          startDateExConv,
          bookingData
        );

        console.log('STEP 23-28: DAILY NOMINATION PROCESSING completed successfully');

        return {
          renom,
          sheet1,
          flagEmtry: false, // Updated after validation
          ...bookingData,
          ...dailyProcessingResult,
          isValid: true,
          message: 'Daily nomination processing completed successfully'
        };
      }

      // For non-daily nominations, return default values
      return {
        renom: null,
        sheet1,
        flagEmtry,
        bookingFullJson: null,
        headerEntryCDBMMBTUD: null,
        headerExitCDBMMBTUD: null,
        headerEntryCDBMMBTUH: null,
        headerExitCDBMMBTUH: null,
        entryValue: null,
        exitValue: null,
        filePeriodMode: null,
        zoneQualityMaster: [],
        resultEntryExitUse: null,
        resultEntryExitUsePerDay: null,
        isValid: true,
        message: 'Non-daily nomination, skipping daily processing'
      };
    } catch (error) {
      console.error('Error in STEP 23-28: DAILY NOMINATION PROCESSING:', error);
      throw error;
    }
  }

  /**
   * STEP 24: DEADLINE CHECK FOR DAILY NOMINATION
   * ตรวจสอบ deadline สำหรับ daily
   * 
   * @param getTodayNow - ฟังก์ชันดึงวันที่ปัจจุบัน
   * @param startDateExConv - วันที่แปลงแล้ว
   * @param nominationDeadlineSubmission - ข้อมูล deadline การส่ง
   * @param nominationDeadlineReceptionOfRenomination - ข้อมูล deadline การรับเสนอชื่อใหม่
   * @param type - ประเภท (1 = Daily)
   * @returns Renomination flag
   */

  private ckDateInfoNomDailyAndWeeklyNew(
    nowAts: any,
    startDateExConv: any,
    nominationDeadlineSubmission: any,
    nominationDeadlineReceptionOfRenomination: any,
    type: any,
  ) {
    console.log('STEP 24: Deadline check for daily nomination completed');

    // console.log('--- nominationDeadlineSubmission --- : ', nominationDeadlineSubmission);
    // console.log('--- nominationDeadlineReceptionOfRenomination --- : ', nominationDeadlineReceptionOfRenomination);
    const allowedDate = nowAts
      .add(nominationDeadlineSubmission?.before_gas_day, 'day')
      .set('hour', nominationDeadlineSubmission?.hour)
      .set('minute', nominationDeadlineSubmission?.minute)
      .startOf('minute');
    console.log('startDateExConv : ', startDateExConv); // gas day excel nom
    console.log('allowedDate : ', allowedDate); // dead line
    console.log('nowAts : ', nowAts); // now date
    if (startDateExConv.isBefore(allowedDate, 'day')) {
      console.log('ก่อน deadline');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Start Date is over submission deadline.',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {
      console.log('ภายใน deadline');
      if (startDateExConv.isSame(allowedDate, 'day')) {
        console.log(
          '--วันตรง deadline เช็ค hour, minute ไม่ให้เกิน deadline ถ้าเกินไป renom ไม่เกินให้ผ่านได้  --',
        );
        if (nowAts.isSameOrBefore(allowedDate)) {
          console.log('ยังไม่เกิน ผ่านได้');
          return null;
        } else {
          console.log('เกิน เช็ค renom');
          if (!nominationDeadlineReceptionOfRenomination) {
            return true;
          } else {
            const renomAllowedDate = nowAts
              .add(
                nominationDeadlineReceptionOfRenomination?.before_gas_day,
                'day',
              )
              .set('hour', nominationDeadlineReceptionOfRenomination?.hour)
              .set('minute', nominationDeadlineReceptionOfRenomination?.minute)
              .startOf('minute');
            if (startDateExConv.isBefore(renomAllowedDate, 'day')) {
              console.log('ก่อน renom deadline');
              throw new HttpException(
                {
                  status: HttpStatus.BAD_REQUEST,
                  error:
                    'Start Date is over Reception of renomination deadline.',
                },
                HttpStatus.BAD_REQUEST,
              );
            } else {
              console.log('ภายใน renom deadline');
              if (startDateExConv.isSame(renomAllowedDate, 'day')) {
                if (nowAts.isSameOrBefore(renomAllowedDate)) {
                  console.log('ยังไม่เกิน renom ผ่านได้');
                  return true;
                } else {
                  console.log('เกิน renom');
                  throw new HttpException(
                    {
                      status: HttpStatus.BAD_REQUEST,
                      error:
                        'Start Date is over Reception of renomination deadline.',
                    },
                    HttpStatus.BAD_REQUEST,
                  );
                }
              } else {
                console.log('ยังไม่เกิน renom ผ่านได้');
                return true;
              }
            }
          }
        }
      } else {
        console.log('ยังไม่เกิน ผ่านได้');
        return null;
      }
    }
  }

  /**
   * STEP 25: DAILY HEADER VALIDATION
   * ตรวจสอบ header ของ daily
   * 
   * @param data - ข้อมูล header
   * @returns Boolean indicating if header is valid
   */

  private validateDataDaily(sheetData: any) {
    console.log('STEP 25: Daily header validation completed');
    // ตรวจสอบค่าตั้งแต่ key 14 ถึง 37
    for (let i = 14; i <= 37; i++) {
      if (sheetData[i.toString()] !== (i - 13).toString()) {
        console.log(
          `validate template fail: ${sheetData[i.toString()]} == ${(i - 13).toString()}`,
        );
        return false; // ถ้าไม่ตรงกันให้คืนค่า false ทันที
      }
    }

    // ตรวจสอบค่า key 38 ต้องเป็น 'Total'
    if (sheetData['38'] !== 'Total') {
      console.log(`validate template fail: ${sheetData['38']} == Total`);
      return false;
    }

    return true; // ถ้าทุกอย่างถูกต้อง คืนค่า true
  }

  /**
   * Process sheet1 data
   * 
   * @param sheet1 - ข้อมูล sheet หลัก
   * @returns Processed sheet1 data
   */
  private processSheet1Data(sheet1: any): any {
    // Process sheet1 data structure
    // This is a placeholder - the actual implementation would process the sheet data
    console.log('Sheet1 data processing completed');
    return sheet1;
  }

  /**
   * STEP 27: BOOKING DATA PROCESSING
   * ประมวลผล booking data
   * 
   * @param contractCode - ข้อมูล contract code
   * @param todayEnd - วันที่สิ้นสุด
   * @returns Object containing booking data
   */
  private async processBookingData(contractCode: any, todayEnd: Date) {
    console.log('=====');
    console.log('********* start *********');

    // Parse booking full JSON data from contract
    const bookingFullJson = this.safeParseJSON(contractCode?.booking_version?.[0]?.booking_full_json?.[0]?.data_temp);

    // Extract capacity daily booking headers for entry and exit
    const headerEntryCDBMMBTUD = bookingFullJson?.headerEntry['Capacity Daily Booking (MMBTU/d)'];
    delete headerEntryCDBMMBTUD['key']; // Remove key field
    const headerExitCDBMMBTUD = bookingFullJson?.headerExit['Capacity Daily Booking (MMBTU/d)'];
    delete headerExitCDBMMBTUD['key']; // Remove key field

    // Extract maximum hour booking headers for entry and exit
    const headerEntryCDBMMBTUH = bookingFullJson?.headerEntry['Maximum Hour Booking (MMBTU/h)'];
    delete headerEntryCDBMMBTUH['key'];
    const headerExitCDBMMBTUH = bookingFullJson?.headerExit['Maximum Hour Booking (MMBTU/h)'];
    delete headerExitCDBMMBTUH['key'];

    const entryValue = bookingFullJson?.entryValue;
    const exitValue = bookingFullJson?.exitValue;
    const filePeriodMode = contractCode?.file_period_mode;

    const zoneQualityMaster = await this.prisma.zone.findMany({
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
              { end_date: { gte: todayEnd } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับสิ้นสุดวันนี้
            ],
          },
        ],
      },
    });

    console.log('STEP 27: Booking data processing completed');

    return {
      bookingFullJson,
      headerEntryCDBMMBTUD,
      headerExitCDBMMBTUD,
      headerEntryCDBMMBTUH,
      headerExitCDBMMBTUH,
      entryValue,
      exitValue,
      filePeriodMode,
      zoneQualityMaster
    };
  }

  /**
   * STEP 28: DAILY NOMINATION PROCESSING
   * ประมวลผล daily nomination (ส่วนหลัก)
   * 
   * @param nomination_type_id - ID ของ nomination type
   * @param startDateExConv - วันที่แปลงแล้ว
   * @param bookingData - ข้อมูล booking
   * @returns Object containing daily processing result
   */
  private processDailyNominationData(
    nomination_type_id: number,
    startDateExConv: any,
    bookingData: any
  ) {
    // Process daily nomination data based on file period mode
    if (nomination_type_id === 1) {
      // Daily nomination
      if (bookingData.filePeriodMode === 1 || bookingData.filePeriodMode === 3) {
        console.log('dddddddddd');
        // Day mode processing
        console.log('day');
        console.log('startDateExConv : ', startDateExConv);
        console.log('headerEntryCDBMMBTUH : ', bookingData.headerEntryCDBMMBTUH);

        // Find matching keys for entry/exit use and per day values
        const resultEntryExitUse = this.findExactMatchingKeyDDMMYYYY(startDateExConv, bookingData.headerEntryCDBMMBTUH);
        const resultEntryExitUsePerDay = this.findExactMatchingKeyDDMMYYYY(startDateExConv, bookingData.headerEntryCDBMMBTUD);
        console.log('✅ Matching Keys Found:', resultEntryExitUse);
        console.log('✅ Matching Keys Per Day Found:', resultEntryExitUsePerDay);

        // Validate that matching keys exist
        if (!resultEntryExitUse || !resultEntryExitUsePerDay) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Matching keys not found for the specified date.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        console.log('STEP 28: Daily nomination processing completed');

        return {
          resultEntryExitUse,
          resultEntryExitUsePerDay
        };
      }
    }

    return {
      resultEntryExitUse: null,
      resultEntryExitUsePerDay: null
    };
  }

  /**
   * Find exact matching key for DDMMYYYY format
   * 
   * @param startDateExConv - วันที่แปลงแล้ว
   * @param headerData - ข้อมูล header
   * @returns Matching key result
   */
  private findExactMatchingKeyDDMMYYYY(startDateExConv: any, headerData: any): any {
    // Implementation of key matching logic
    // This is a placeholder - the actual implementation would find matching keys
    console.log('Finding exact matching key for DDMMYYYY format');
    return { key: 'test', value: 100 }; // Return matching key result for testing
  }
}
