import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx-js-style';
// import * as XlsxPopulate from 'xlsx-populate';
import * as fs from 'fs';

import customParseFormat from 'dayjs/plugin/customParseFormat';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween';
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { CapacityV2Service } from 'src/capacity-v2/capacity-v2.service';
import { QueryShipperNominationFileService } from 'src/query-shipper-nomination-file/query-shipper-nomination-file.service';
import {
  getTodayEnd,
  getTodayEndAdd7,
  getTodayEndDDMMYYYYAdd7,
  getTodayEndDDMMYYYYDfaultAdd7,
  getTodayNow,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfault,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStart,
  getTodayStartAdd7,
  getTodayStartDDMMYYYYAdd7,
  getTodayStartDDMMYYYYDfaultAdd7,
} from 'src/common/utils/date.util';
import { uploadFilsTemp } from 'src/common/utils/uploadFileIn';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

const headNom = [
  'Zone',
  'Supply/Demand',
  'Area',
  'POINT_ID',
  'W/HV',
  'Park/UnparkInstructed Flows',
  'Type',
  'Area_Code',
  'Subarea_Code',
  'Unit',
  'Entry_Exit',
  'WI',
  'HV',
  'SG',
];
const headNomSheet2 = [
  'Zone',
  'Point',
  'CO2',
  'C1',
  'C2',
  'C3',
  'iC4',
  'nC4',
  'iC5',
  'nC5',
  'C6',
  'C7',
  'C2+',
  'N2',
  'O2',
  'H2S',
  'S',
  'Hg',
];

const headNomSheet3 = [
  [], // Row 0
  ['Supply/Demand'], // Row 1
  ['Supply'],
  ['Demand'],
  [],
  [],
  [],
  ['WI/HV'],
  ['East WI'],
  ['East HV'],
  ['East-West WI'],
  ['East-West HV'],
  ['West WI'],
  ['West HV'],
  [],
  [],
  ['Park/Unpark-Instructed Flows'],
  ['Unpark'],
  ['Instructed_Entry'],
  ['Park'],
  ['Instructed_Exit'],
  ['Shrinkage_Volume'],
  ['Min_Inventory_Change'],
  ['Exchange_Mininventory'],
  [],
  [],
  ['Type'],
  ['Sales GSP'],
  ['Bypass Gas'],
  ['Common Header'],
  ['Super Header'],
  ['LNG'],
  ['W-SUPPLY'],
  ['Other'],
  ['SPP'],
  ['IND'],
  ['NGV'],
  ['NGD'],
  ['FUEL'],
  ['EGAT'],
  ['IPP'],
  [],
  [],
  [],
  ['Unit'],
  ['MMBTU/D'],
  ['MMSCFD'],
  ['MMSCFH'],
  ['%'],
  ['BTU/SCF'],
  ['Unitless'],
  ['%.MOL'],
  ['PPM.VOL'],
  ['PPM.VOL.DEG'],
  ['microG.M3'],
  ['PPM.WEIGHT'],
  ['LB.MMSCF'],
  ['DEG.F'],
  ['MJ/m3'],
  [],
  [],
  [],
  [],
  ['Entry_Exit'],
  ['Entry'],
  ['Exit'],
  [],
  [],
  ['Quality Parameters'],
  ['CO2'],
  ['C1'],
  ['C2'],
  ['C3'],
  ['iC4'],
  ['nC4'],
  ['iC5'],
  ['nC5'],
  ['C6'],
  ['C7'],
  ['C2+'],
  ['N2'],
  ['O2'],
  ['H2S'],
  ['S'],
  ['Hg'],
  ['Total'],
  ['LHV dry'],
  ['LHV sat'],
  ['HHV dry'],
  ['HHV sat (Btu/scf)'],
  ['SG'],
  ['WI : HHVdry/sqrt(SG)'],
  ['WI : MJ/m3'],
];

const daily = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  'Total',
];

@Injectable()
export class SubmissionFileService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly capacityV2Service: CapacityV2Service,
    private readonly uploadTemplateForShipperService: UploadTemplateForShipperService,
    private readonly queryShipperNominationFileService: QueryShipperNominationFileService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) { }

  private safeParseJSON(jsonString: string): any {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.error('Error parsing JSON:', error);
      return null;
    }
  }

  // getNextSundayDates
  // componentGenExcelNom
  // objToArr
  // truncateArrayHeadSheet1
  // truncateArrayHeadSheet2

  validateDataDaily(sheetData: any) {
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

  validateDataWeekly(sheetData: any, startDateExConv: any): boolean {
    // เริ่มต้นตรวจสอบตั้งแต่ key 14 ถึง key 20 (7 วัน)
    for (let i = 14; i <= 20; i++) {
      const expectedDate = dayjs(startDateExConv)
        .add(i - 14, 'day')
        .format('DD/MM/YYYY');
      const actualDate = sheetData[i.toString()];

      console.log(
        `Checking key ${i}: expected ${expectedDate}, found ${actualDate}`,
      );

      if (actualDate !== expectedDate) {
        return false; // ถ้าเจอวันที่ไม่ตรงกัน ให้คืนค่า false ทันที
      }
    }

    return true; // ถ้าวันที่ถูกต้องทั้งหมด คืนค่า true
  }

  ckDateInfoNomDailyAndWeeklyNew(
    nowAts: any,
    startDateExConv: any,
    nominationDeadlineSubmission: any,
    nominationDeadlineReceptionOfRenomination: any,
    type: any,
  ) {
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

  findMatchingKeyMMYYYY(startDateExConv: any, headerEntry: any): string | null {
    const targetMonth = startDateExConv.month(); // เดือน (0 = มกราคม)
    const targetYear = startDateExConv.year(); // ปี

    for (const date in headerEntry) {
      const currentDate = dayjs(date, 'DD/MM/YYYY');
      const currentMonth = currentDate.month();
      const currentYear = currentDate.year();

      console.log(
        `Checking date: ${date} (Month: ${currentMonth}, Year: ${currentYear})`,
      );

      if (currentMonth === targetMonth && currentYear === targetYear) {
        return headerEntry[date].key; // คืนค่า key ถ้าตรงกัน
      }
    }

    return null; // ถ้าไม่ตรงกันเลย คืนค่า null
  }

  findExactMatchingKeyDDMMYYYY(
    startDateExConv: any,
    headerEntry: any,
  ): string | null {
    const targetDate = startDateExConv.format('DD/MM/YYYY'); // แปลงเป็นรูปแบบเดียวกัน

    for (const date in headerEntry) {
      if (date === targetDate) {
        return headerEntry[date].key; // คืนค่า key ถ้าตรงกัน
      }
    }

    return null; // ถ้าไม่ตรงกันเลย คืนค่า null
  }

  transformColumn(data: any) {
    return data.map((item: any) => ({
      ...item,
      row: Object.fromEntries(
        item.row.map((value: any, index: number) => [index, value]),
      ),
    }));
  }

  transformColumnDF(data: any) {
    return Object.fromEntries(
      data.map((value: any, index: number) => [index, value]),
    );
  }

  formatNumberThreeDecimal(number: any) {
    if (isNaN(number)) return number; // Handle invalid numbers gracefully

    // Convert number to a fixed 3-decimal format
    const fixedNumber = parseFloat(number).toFixed(3);

    // Add thousand separators
    return fixedNumber.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  async uploadFile(
    file: any,
    fileOriginal: any,
    userId: any,
    comment: any,
    tabType: any,
  ) {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    // const nowAts = getTodayNow()
    const nowAts = getTodayNowAdd7();

    const gAuserType = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId || 0),
          },
        },
      },
    });

    // --

    const findData = this.safeParseJSON(file?.jsonDataMultiSheet) || [];
    const checkType = findData.reduce((acc: string | null, f: any) => {
      if (f?.sheet === 'Daily Nomination') return 'Daily Nomination';
      if (f?.sheet === 'Weekly Nomination') return 'Weekly Nomination';
      return acc;
    }, null);

    const nomination_type_id =
      checkType === 'Daily Nomination'
        ? 1
        : checkType === 'Weekly Nomination'
          ? 2
          : null;

    if (nomination_type_id != tabType) {
      console.log('1');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'File template does not match the required format.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    //  --

    let sheet1 = findData.find((f: any) => {
      return f?.sheet === checkType;
    });
    let sheet2 = findData.find((f: any) => {
      return f?.sheet === 'Quality';
    });
    let sheet3 = findData.find((f: any) => {
      return f?.sheet === 'Lists';
    });


    // ['SHIPPER ID', 'CONTRACT CODE', 'START DATE']
    if (sheet1?.data?.[0]?.[0] !== 'SHIPPER ID') {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'contract code not have system',
          error: 'Header SHIPPER ID Missing.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (sheet1?.data?.[0]?.[1] !== 'CONTRACT CODE') {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'contract code not have system',
          error: 'Header Contract Code is incorrect.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (sheet1?.data?.[0]?.[2] !== 'START DATE') {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'contract code not have system',
          error: 'Header START DATE Missing.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const shipper = await this.prisma.group.findFirst({
      where: {
        id_name: sheet1?.data?.[1]?.[0],
        status: true,
        //
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
        id_name: sheet1?.data?.[1]?.[0],
      },
    });

    const contractCodeName = await this.prisma.contract_code.findFirst({
      where: {
        contract_code: sheet1?.data?.[1]?.[1],
        AND: [
          {
            contract_start_date: {
              lte: getTodayNowDDMMYYYYDfaultAdd7(sheet1?.data?.[1]?.[2]).toDate(), // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
            },
            contract_end_date: {
              gte: getTodayNowDDMMYYYYDfaultAdd7(sheet1?.data?.[1]?.[2]).toDate(),
            },
          },
          // {
          // OR: [
          //   { contract_end_date: null }, // ถ้า end_date เป็น null
          //   { contract_end_date: { gte: getTodayNowDDMMYYYYDfaultAdd7(sheet1?.data?.[1]?.[2]).toDate() } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
          // ],
          // },
        ],
        status_capacity_request_management: {
          id: {
            in: [2],
          },
        },
        // contract_start_date: {
        //   lte: getTodayNowDDMMYYYYDfaultAdd7(sheet1?.data?.[1]?.[2]).toDate(),
        // },
        // เช็คเงื่อนไข enddate ทั้งหมด
      },
      include: {
        group: true,
      },
    });
    const contractCodeNameCompare = await this.prisma.contract_code.findFirst({
      where: {
        contract_code: sheet1?.data?.[1]?.[1],
      },
    });
    const shipper_id = shipper?.id;
    const contract_code_id = contractCodeName?.id;
    const startDateEx = sheet1?.data?.[1]?.[2];

    if (!shipper_id && !!shipperCompare?.id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'contract code not have system',
          error: 'Shipper is inactivated.',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else if (!shipperCompare?.id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Shipper ID is inactive.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    console.log('contract_code_id : ', contract_code_id);
    console.log('contractCodeNameCompare : ', contractCodeNameCompare);

    if (!contract_code_id && !!contractCodeNameCompare?.id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'contract code not have system',
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

    // https://app.clickup.com/t/86eumc15d
    if (contractCodeName?.group?.name !== shipper?.name) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code is incorrect.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // console.log('gAuserType : ', gAuserType);

    // เช็ค shipper
    if (gAuserType?.user_type_id === 3) {
      if (gAuserType?.id_name !== sheet1?.data?.[1]?.[0]) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'contract code not have system',
            // error: 'Shipper is incorrected',
            error: 'Shipper is not matched.', // https://app.clickup.com/t/86etzcgux
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (!sheet1?.data?.[1]?.[1]) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'contract code not have system',
          error: 'Contract Code is incorrect.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!contract_code_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'contract code not have system',
          error: 'Contract Code does not match.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkTemplate =
      await this.prisma.upload_template_for_shipper.findFirst({
        where: {
          group_id: Number(shipper_id || 0), //33
          contract_code_id: Number(contract_code_id || 0), //82
          nomination_type_id: Number(nomination_type_id || 0), //1
          AND: [
            {
              OR: [{ del_flag: false }, { del_flag: null }],
            },
          ],
        },
      });

    if (!checkTemplate) {
      // ไม่มี
      console.log('2');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: 'ไม่พบ template',
          error: 'File template does not match the required format.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const contractCode = await this.prisma.contract_code.findFirst({
      where: {
        // status_capacity_request_management_id: 2,
        status_capacity_request_management: {
          id: {
            in: [2, 3, 5],
          },
        },
        // status_capacity_request_management_process_id: 2,
        id: Number(contract_code_id || 0),
        OR: [
          {
            ref_contract_code_by_main_id: Number(contract_code_id || 0),
          },
        ],
      },
      include: {
        group: true,
        booking_version: {
          include: {
            booking_full_json: true,
            booking_row_json: true,
          },
          take: 1,
          orderBy: { id: 'desc' },
        },
      },
      take: 1,
      orderBy: { id: 'desc' },
    });

    if (contractCode?.status_capacity_request_management_id === 3) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Nomination upload not allowed : Capacity Right is rejected.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }


    if (
      !contractCode ||
      contractCode?.status_capacity_request_management_id === 5
    ) {
      console.log('3');
      //
      if (contractCode?.status_capacity_request_management_id === 5) {
        // contractCode?.terminate_date
        const isFuture = getTodayNowAdd7(contractCode?.terminate_date).isBefore(
          getTodayStartAdd7(),
          'day',
        );
        if (isFuture) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              // error: 'Do not have contract code or status not approved',
              error: 'File template does not match the required format.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      } else {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'Do not have contract code or status not approved',
            error: 'File template does not match the required format.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const nominationDeadlineSubmission =
      await this.prisma.new_nomination_deadline.findFirst({
        where: {
          process_type_id: 1,
          user_type_id: gAuserType?.user_type_id,
          nomination_type_id: Number(nomination_type_id || 0),
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
    if (!nominationDeadlineSubmission) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Deadline is missing. Please configure it before proceeding.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const nominationDeadlineReceptionOfRenomination =
      await this.prisma.new_nomination_deadline.findFirst({
        where: {
          process_type_id: 3,
          user_type_id: gAuserType?.user_type_id,
          nomination_type_id: Number(nomination_type_id || 0),
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

    // ----


    // https://app.clickup.com/t/86etzch2g

    if (nomination_type_id === 2) {
      function isSunday(dateStr: string) {
        const d = dayjs(dateStr, 'DD/MM/YYYY', true); // true = strict parse
        return d.isValid() && d.day() === 0;
      }
      if (!isSunday(startDateEx)) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'The date in the template must start from Sunday.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (
        getTodayNowDDMMYYYYDfaultAdd7(startDateEx)
          .add(0, 'day')
          .format('DD/MM/YYYY') !== sheet1?.data?.[2]?.[14]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        getTodayNowDDMMYYYYDfaultAdd7(startDateEx)
          .add(1, 'day')
          .format('DD/MM/YYYY') !== sheet1?.data?.[2]?.[15]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        getTodayNowDDMMYYYYDfaultAdd7(startDateEx)
          .add(2, 'day')
          .format('DD/MM/YYYY') !== sheet1?.data?.[2]?.[16]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        getTodayNowDDMMYYYYDfaultAdd7(startDateEx)
          .add(3, 'day')
          .format('DD/MM/YYYY') !== sheet1?.data?.[2]?.[17]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        getTodayNowDDMMYYYYDfaultAdd7(startDateEx)
          .add(4, 'day')
          .format('DD/MM/YYYY') !== sheet1?.data?.[2]?.[18]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        getTodayNowDDMMYYYYDfaultAdd7(startDateEx)
          .add(5, 'day')
          .format('DD/MM/YYYY') !== sheet1?.data?.[2]?.[19]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        getTodayNowDDMMYYYYDfaultAdd7(startDateEx)
          .add(6, 'day')
          .format('DD/MM/YYYY') !== sheet1?.data?.[2]?.[20]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    console.log('-----');

    // ..

    const startDateExConv = getTodayNowDDMMYYYYDfault(startDateEx);
    console.log('startDateExConv : ', startDateExConv);
    let renom = null;
    let getsValue = [];
    const getsValueNotMatch = [];
    const getsValuePark = [];
    const getsValueSheet2 = [];
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
    const fullDataRow = [];
    let flagEmtry = true;

    const nominationPoint = await this.prisma.nomination_point.findMany({
      where: {
        AND: [
          {
            start_date: {
              // lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
              lte: getTodayEndDDMMYYYYDfaultAdd7(startDateEx).toDate(), // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
            },
          },
          {
            OR: [
              { end_date: null }, // ถ้า end_date เป็น null
              // { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
              {
                end_date: {
                  gt: getTodayStartDDMMYYYYDfaultAdd7(startDateEx).toDate(),
                },
              }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
      },
      // where: {
      //   AND: [
      //     {
      //       start_date: {
      //         lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
      //       },
      //     },
      //     {
      //       OR: [
      //         { end_date: null }, // ถ้า end_date เป็น null
      //         { end_date: { gt: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
      //       ],
      //     },
      //   ],
      // },
      orderBy: {
        end_date: 'desc',
      },
      include: {
        contract_point_list: {
          include: {
            area: true,
            zone: true,
            entry_exit: true,
          },
        },
        area: true,
        zone: true,
        entry_exit: true,
      },
    });
    const nonTpa = await this.prisma.non_tpa_point.findMany({
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
      include: {
        nomination_point: {
          include: {
            contract_point_list: {
              include: {
                area: true,
                zone: true,
                entry_exit: true,
              },
            },
            area: true,
            zone: true,
            entry_exit: true,
          },
        },
      },
    });
    // 

    console.log('nominationPoint : ', nominationPoint);

    // startDateEx weekly
    // console.log('startDateEx : ', startDateEx);
    // console.log(getTodayEndDDMMYYYYDfaultAdd7(startDateEx).toDate());
    const conceptPoint = await this.prisma.concept_point.findMany({
      where: {
        AND: [
          {
            start_date: {
              // lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
              lte: getTodayEndDDMMYYYYDfaultAdd7(startDateEx).toDate(), // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
            },
          },
          {
            OR: [
              { end_date: null }, // ถ้า end_date เป็น null
              // { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
              {
                end_date: {
                  gte: getTodayStartDDMMYYYYDfaultAdd7(startDateEx).toDate(),
                },
              }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
      },
      include: {
        limit_concept_point: {
          include: {
            group: true,
          },
        },
        type_concept_point: true,
      },
    });

    // ......

    console.log('nominationPoint : ', nominationPoint);
    console.log('contractCode : ', contractCode);
    console.log(`sheet1?.data?.[1]?.[1] : `, sheet1?.data?.[1]?.[1]);

    if (!!checkType && !!sheet2) {
      if (
        contractCode?.contract_code !== sheet1?.data?.[1]?.[1] &&
        contractCode?.group?.id_name !== sheet1?.data?.[1]?.[0]
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'contract code ไม่ตรง & shipper id ไม่ตรง',
            error: 'Contract Code & Shipper ID is incorrect.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (contractCode?.contract_code !== sheet1?.data?.[1]?.[1]) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'contract code ไม่ตรง',
            error: 'Contract Code does not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (contractCode?.group?.id_name !== sheet1?.data?.[1]?.[0]) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'shipper id ไม่ตรง',
            error: 'Shipper ID does not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        // check หัว
        // 0-13 14++++
        const isEqual = headNom.every(
          (val, index) => val === sheet1?.data?.[2]?.[index],
        );

        if (!isEqual) {
          console.log('4');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              // error: 'Head Sheet 1 ไม่ตรง',
              error: 'File template does not match the required format.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        const isEqualSheet2 = headNomSheet2.every(
          (val, index) => val === sheet2?.data?.[0]?.[index],
        );

        if (!isEqualSheet2) {
          console.log('5');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              // error: 'Head Sheet 2 ไม่ตรง',
              error: 'File template does not match the required format.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (checkType === 'Daily Nomination') {
          if (Number(nomination_type_id || 0) !== 1) {
            console.log('6');
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                // error: 'nomination type ไม่ตรง',
                error: 'File template does not match the required format.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          // 'Daily Nomination'
          renom = this.ckDateInfoNomDailyAndWeeklyNew(
            getTodayNow(),
            startDateExConv,
            nominationDeadlineSubmission,
            nominationDeadlineReceptionOfRenomination,
            1,
          );

          const ckDateHead = this.validateDataDaily(sheet1?.data?.[2]);
          if (!ckDateHead) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                // error: 'date head ไม่ตรงตามเงื่อนไข',
                error: 'The hour in the template must start from 1 to 24.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          sheet1 = {
            ...sheet1,
            data: [
              [],
              this.uploadTemplateForShipperService.objToArr(sheet1?.data?.[0]),
              this.uploadTemplateForShipperService.objToArr(sheet1?.data?.[1]),
              [
                ...this.uploadTemplateForShipperService.objToArr(
                  sheet1?.data?.[2],
                ),
                // ...daily,
              ],
              ...sheet1?.data
                .slice(3)
                .map((e: any) =>
                  this.uploadTemplateForShipperService.objToArr(e),
                ),
            ],
          };
          sheet1.data = sheet1.data?.map((sd: any) => {
            const sdA = sd?.map((sdA: any) => {
              let valuesDa = sdA;
              valuesDa = valuesDa?.trim()?.replace(/,/g, '');
              if (
                valuesDa &&
                valuesDa.startsWith('(') &&
                valuesDa.endsWith(')')
              ) {
                valuesDa = '-' + valuesDa.slice(1, -1);
              }
              return valuesDa;
            });
            return sdA;
          });
          sheet2 = {
            ...sheet2,
            data: [
              [],
              [
                ...this.uploadTemplateForShipperService.truncateArrayHeadSheet2(
                  this.uploadTemplateForShipperService.objToArr(sheet2.data[0]),
                ),
              ],
              ...sheet2?.data
                .slice(1)
                .map((e: any) =>
                  this.uploadTemplateForShipperService.truncateArrayHeadSheet2(
                    this.uploadTemplateForShipperService.objToArr(e),
                  ),
                ),
            ],
          };
          sheet3 = { ...sheet3, data: headNomSheet3 };

          for (let i = 0; i < sheet1?.data.length; i++) {
            const zoneCk = sheet1?.data?.[i]?.[0] || null;
            const supplyDemandCk = sheet1?.data?.[i]?.[1] || null;
            const areaCk = sheet1?.data?.[i]?.[2] || null;
            const pointIdCk = sheet1?.data?.[i]?.[3] || null;
            const wHvCk = sheet1?.data?.[i]?.[4] || null;
            const parkUnparkInstructedFlowsCk = sheet1?.data?.[i]?.[5] || null;
            const typeCk = sheet1?.data?.[i]?.[6] || null;
            const areaCodeCk = sheet1?.data?.[i]?.[7] || null;
            const subareaCodeCk = sheet1?.data?.[i]?.[8] || null;
            const unitCk = sheet1?.data?.[i]?.[9] || null;
            const entryExitCk = sheet1?.data?.[i]?.[10] || null;
            const wiCk = sheet1?.data?.[i]?.[11] || null;
            const hvCk = sheet1?.data?.[i]?.[12] || null;
            const sgCk = sheet1?.data?.[i]?.[13] || null;
            const hr1Ck = sheet1?.data?.[i]?.[14] || null;
            const hr2Ck = sheet1?.data?.[i]?.[15] || null;
            const hr3Ck = sheet1?.data?.[i]?.[16] || null;
            const hr4Ck = sheet1?.data?.[i]?.[17] || null;
            const hr5Ck = sheet1?.data?.[i]?.[18] || null;
            const hr6Ck = sheet1?.data?.[i]?.[19] || null;
            const hr7Ck = sheet1?.data?.[i]?.[20] || null;
            const hr8Ck = sheet1?.data?.[i]?.[21] || null;
            const hr9Ck = sheet1?.data?.[i]?.[22] || null;
            const hr10Ck = sheet1?.data?.[i]?.[23] || null;
            const hr11Ck = sheet1?.data?.[i]?.[24] || null;
            const hr12Ck = sheet1?.data?.[i]?.[25] || null;
            const hr13Ck = sheet1?.data?.[i]?.[26] || null;
            const hr14Ck = sheet1?.data?.[i]?.[27] || null;
            const hr15Ck = sheet1?.data?.[i]?.[28] || null;
            const hr16Ck = sheet1?.data?.[i]?.[29] || null;
            const hr17Ck = sheet1?.data?.[i]?.[30] || null;
            const hr18Ck = sheet1?.data?.[i]?.[31] || null;
            const hr19Ck = sheet1?.data?.[i]?.[32] || null;
            const hr20Ck = sheet1?.data?.[i]?.[33] || null;
            const hr21Ck = sheet1?.data?.[i]?.[34] || null;
            const hr22Ck = sheet1?.data?.[i]?.[35] || null;
            const hr23Ck = sheet1?.data?.[i]?.[36] || null;
            const hr24Ck = sheet1?.data?.[i]?.[37] || null;
            const totalCk = sheet1?.data?.[i]?.[38] || null;
            // console.log('i : ', i);
            // console.log('zoneCk : ', zoneCk);
            // console.log('supplyDemandCk : ', supplyDemandCk);
            // console.log('typeCk : ', typeCk);
            if (i > 3) {
              if (
                hr1Ck ||
                hr2Ck ||
                hr3Ck ||
                hr4Ck ||
                hr5Ck ||
                hr6Ck ||
                hr7Ck ||
                hr8Ck ||
                hr9Ck ||
                hr10Ck ||
                hr11Ck ||
                hr12Ck ||
                hr13Ck ||
                hr14Ck ||
                hr15Ck ||
                hr16Ck ||
                hr17Ck ||
                hr18Ck ||
                hr19Ck ||
                hr20Ck ||
                hr21Ck ||
                hr22Ck ||
                hr23Ck ||
                hr24Ck
              ) {
                flagEmtry = false;
              }

              fullDataRow.push({
                ix: i,
                row: sheet1?.data?.[i],
              });

              const checkNominationPoint = nominationPoint?.find((fnp: any) => {
                return fnp?.nomination_point === pointIdCk;
              });
              if (areaCk && !checkNominationPoint) {
                console.log('1 Nomination Point is incorrect.');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: `Nomination Point is incorrect.`, // https://sharing.clickup.com//9018502823/t/h/86euxnaeg/SFVBI9PW12U844A
                  },
                  HttpStatus.FORBIDDEN,
                );
              }
              // console.log('nominationPoint : ', nominationPoint);
              // console.log('pointIdCk : ', pointIdCk);
              if (typeCk === 'NONTPA') {
                const checkNonTPA = nonTpa.find((fn: any) => {
                  return fn?.non_tpa_point_name === pointIdCk;
                });
                if (checkNonTPA) {
                  if (checkNonTPA?.nomination_point) {
                    // ถ้าตรงทั้งหมดไปหาว่า Nomination Point นี้ใช้ Zone , Area, Entry/Exit และ Contract Point ที่มีอยู่ในสัญญาหรือไม่
                    let checkNom = false;
                    for (
                      let ifb = 0;
                      ifb <
                      (contractCode?.booking_version?.[0]?.booking_row_json || [])
                        .length;
                      ifb++
                    ) {
                      const findPoint =
                        checkNonTPA?.nomination_point?.contract_point_list.find(
                          (inb: any) => {
                            return (
                              inb?.contract_point ===
                              contractCode?.booking_version?.[0]
                                ?.booking_row_json?.[ifb]?.contract_point
                            );
                          },
                        );
                      if (findPoint) {
                        if (
                          findPoint?.area?.name ===
                          checkNonTPA?.nomination_point?.area?.name &&
                          findPoint?.zone?.name ===
                          checkNonTPA?.nomination_point?.zone?.name &&
                          findPoint?.entry_exit?.name ===
                          checkNonTPA?.nomination_point?.entry_exit?.name
                        ) {
                          checkNom = true;
                        }
                      }
                    }
                    if (checkNom) {
                      // เพิ่มเงื่อนไข (ยังไม่ได้ทำ)
                      // https://app.clickup.com/t/86et0vtn2
                      // v2.0.16 Value Non TPA มากกว่า Nom ไม่มี Error แจ้งเตือน

                      caseData?.columnType.push({
                        ix: i,
                        row: sheet1?.data?.[i],
                      });
                    } else {
                      console.log('2 Nomination Point is incorrect.');
                      throw new HttpException(
                        {
                          status: HttpStatus.FORBIDDEN,
                          // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                          // error: `${checkNonTPA?.nomination_point?.nomination_point || "Nomination Point"} is not found in file for ${sheet1?.data?.[i]?.[3]}`,
                          error: `Nomination Point is incorrect.`, // https://app.clickup.com/t/86etzcgzh
                        },
                        HttpStatus.FORBIDDEN,
                      );
                    }
                  } else {
                    console.log('2');
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        error: `${checkNonTPA?.nomination_point?.nomination_point || 'Nomination Point'} is not found in file for ${sheet1?.data?.[i]?.[3]}`,
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  }
                } else {
                  console.log('3');
                  throw new HttpException(
                    {
                      status: HttpStatus.FORBIDDEN,
                      // error: `${checkNonTPA?.nomination_point?.nomination_point || "Nomination Point"} is not found in file for ${sheet1?.data?.[i]?.[3]}`,
                      error: `${sheet1?.data?.[i]?.[3]} is  not activated on Gas Day in the file.`,
                    },
                    HttpStatus.FORBIDDEN,
                  );
                }
              } else if (checkNominationPoint) {
                // ใช่ nom
                const supdemCk = supplyDemandCk === 'Supply' ? 'Entry' : 'Exit';
                if (
                  areaCk === checkNominationPoint?.area?.name &&
                  zoneCk === checkNominationPoint?.zone?.name &&
                  supdemCk === checkNominationPoint?.entry_exit?.name
                ) {
                  let checkNom = false;
                  for (
                    let ifb = 0;
                    ifb <
                    (contractCode?.booking_version?.[0]?.booking_row_json || [])
                      .length;
                    ifb++
                  ) {
                    const findPoint =
                      checkNominationPoint?.contract_point_list.find(
                        (inb: any) => {
                          return (
                            inb?.contract_point ===
                            contractCode?.booking_version?.[0]?.booking_row_json?.[
                              ifb
                            ]?.contract_point
                          );
                        },
                      );

                    if (findPoint) {
                      // console.log('findPoint : ', findPoint);
                      if (
                        findPoint?.area?.name ===
                        checkNominationPoint?.area?.name &&
                        findPoint?.zone?.name ===
                        checkNominationPoint?.zone?.name &&
                        findPoint?.entry_exit?.name ===
                        checkNominationPoint?.entry_exit?.name
                      ) {
                        checkNom = true;
                      }
                    }
                  }
                  console.log('*** : ', typeCk);
                  if (checkNom) {
                    // non ปกติ
                    caseData?.columnPointId.push({
                      ix: i,
                      row: sheet1?.data?.[i],
                    });
                  } else {
                    console.log('4');
                    // ไม่ตรงเงื่อนไขใน nomination deadline
                    console.log(
                      'contractCode?.booking_version?.[0]?.booking_row_json : ',
                      contractCode?.booking_version?.[0]?.booking_row_json,
                    );
                    console.log(
                      'checkNominationPoint?.area?.name : ',
                      checkNominationPoint?.area?.name,
                    );
                    console.log(
                      'checkNominationPoint?.zone?.name : ',
                      checkNominationPoint?.zone?.name,
                    );
                    console.log(
                      'checkNominationPoint?.entry_exit?.name : ',
                      checkNominationPoint?.entry_exit?.name,
                    );
                    console.log(
                      'checkNominationPoint?.contract_point_list : ',
                      checkNominationPoint?.contract_point_list,
                    );
                    console.log(
                      'checkNominationPoint : ',
                      checkNominationPoint,
                    );
                    console.log(
                      '(contractCode?.booking_version?.[0]?.booking_row_json || []) : ',
                      contractCode?.booking_version?.[0]?.booking_row_json || [],
                    );

                    console.log('3 Nomination Point is incorrect.');
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                        // error: `${areaCk}, ${zoneCk}, or ${supdemCk} for ${sheet1?.data?.[i]?.[3]}  is incorrected`,
                        error: `Nomination Point is incorrect.`, // https://app.clickup.com/t/86etzcgzh
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  }
                } else {
                  // ถ้าไม่ตรง
                  console.log('checkNominationPoint : ', checkNominationPoint);
                  console.log('areaCk : ', areaCk);
                  console.log(
                    'checkNominationPoint?.area?.name : ',
                    checkNominationPoint?.area?.name,
                  );
                  console.log('zoneCk : ', zoneCk);
                  console.log(
                    'checkNominationPoint?.zone?.name : ',
                    checkNominationPoint?.zone?.name,
                  );
                  console.log('supdemCk : ', supdemCk);
                  console.log(
                    'checkNominationPoint?.entry_exit?.name : ',
                    checkNominationPoint?.entry_exit?.name,
                  );
                  console.log('5 ---');
                  throw new HttpException(
                    {
                      status: HttpStatus.FORBIDDEN,
                      error: `${areaCk}, ${zoneCk}, or ${supdemCk} for ${sheet1?.data?.[i]?.[3]}  is incorrected`,
                    },
                    HttpStatus.FORBIDDEN,
                  );
                }
              } else {
                // ไม่ใช่ nom
                if (!!sheet1?.data?.[i]?.[0] && sheet1?.data?.[i]?.[3]) {
                  const findConcept = conceptPoint?.find((f: any) => {
                    return f?.concept_point === sheet1?.data?.[i]?.[3];
                  });

                  if (!findConcept) {
                    console.log(sheet1?.data?.[i]?.[3]);
                    console.log('1 Concept Point is inactivated.');
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        // error: `${sheet1?.data?.[i]?.[3]} is incorrected`,
                        // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                        error: `Concept Point is inactivated.`,
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  } else if (
                    !findConcept?.limit_concept_point?.find(
                      (f: any) => f?.group?.id_name === shipper?.id_name,
                    )
                  ) {
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        // error: `${sheet1?.data?.[i]?.[3]} is incorrected`,
                        // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                        error: `No permission for this Concept Point ${sheet1?.data?.[i]?.[3]} ,Please set the limit first.`, // https://app.clickup.com/t/86etzch1z // https://app.clickup.com/t/86etzcgza
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  }
                  caseData?.columnPointIdConcept.push({
                    ix: i,
                    row: sheet1?.data?.[i],
                  });
                } else {
                  // console.log(`i : `, i);
                  caseData?.columnOther.push({
                    ix: i,
                    row: sheet1?.data?.[i],
                  });
                }
              }
            }
          }

          for (let i = 0; i < sheet2?.data.length; i++) {
            const zoneCk = sheet2?.data?.[i]?.[0] || null;
            const pointIdCk = sheet2?.data?.[i]?.[1] || null;

            if (i > 0 && !!zoneCk && !!pointIdCk) {
              const ckContractPoint =
                await this.prisma.nomination_point.findFirst({
                  where: {
                    zone: {
                      name: zoneCk,
                    },
                    nomination_point: pointIdCk,
                  },
                });
              if (ckContractPoint) {
                getsValueSheet2.push({
                  ix: i,
                  row: sheet1?.data?.[i],
                });
              }
            }
          }
        } else {
          if (Number(nomination_type_id || 0) !== 2) {
            console.log('7');
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                // error: 'nomination type ไม่ตรง',
                error: 'File template does not match the required format.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          // 'Weekly Nomination'
          console.log('w');

          renom = this.ckDateInfoNomDailyAndWeeklyNew(
            getTodayNow(),
            startDateExConv,
            nominationDeadlineSubmission,
            nominationDeadlineReceptionOfRenomination,
            2,
          );

          sheet1 = {
            ...sheet1,
            data: [
              [],
              this.uploadTemplateForShipperService.objToArr(sheet1?.data?.[0]),
              this.uploadTemplateForShipperService.objToArr(sheet1?.data?.[1]),
              [
                ...this.uploadTemplateForShipperService.objToArr(
                  sheet1?.data?.[2],
                ),
                // ...weekly,
              ],
              ...sheet1?.data
                .slice(3)
                .map((e: any) =>
                  this.uploadTemplateForShipperService.objToArr(e),
                ),
            ],
          };
          sheet1.data = sheet1.data?.map((sd: any) => {
            const sdA = sd?.map((sdA: any) => {
              let valuesDa = sdA;
              valuesDa = valuesDa?.trim()?.replace(/,/g, '');
              if (
                valuesDa &&
                valuesDa.startsWith('(') &&
                valuesDa.endsWith(')')
              ) {
                valuesDa = '-' + valuesDa.slice(1, -1);
              }
              return valuesDa;
            });
            return sdA;
          });
          console.log('sheet1.data');
          console.log('sheet1 : ', sheet1);
          sheet2 = {
            ...sheet2,
            data: [
              [],
              [
                ...this.uploadTemplateForShipperService.truncateArrayHeadSheet2(
                  this.uploadTemplateForShipperService.objToArr(sheet2.data[0]),
                ),
              ],
              ...sheet2?.data
                .slice(1)
                .map((e: any) =>
                  this.uploadTemplateForShipperService.truncateArrayHeadSheet2(
                    this.uploadTemplateForShipperService.objToArr(e),
                  ),
                ),
            ],
          };
          sheet3 = { ...sheet3, data: headNomSheet3 };

          for (let i = 0; i < sheet1?.data.length; i++) {
            const zoneCk = sheet1?.data?.[i]?.[0] || null;
            const supplyDemandCk = sheet1?.data?.[i]?.[1] || null;
            const areaCk = sheet1?.data?.[i]?.[2] || null;
            const pointIdCk = sheet1?.data?.[i]?.[3] || null;
            const wHvCk = sheet1?.data?.[i]?.[4] || null;
            const parkUnparkInstructedFlowsCk = sheet1?.data?.[i]?.[5] || null;
            const typeCk = sheet1?.data?.[i]?.[6] || null;
            const areaCodeCk = sheet1?.data?.[i]?.[7] || null;
            const subareaCodeCk = sheet1?.data?.[i]?.[8] || null;
            const unitCk = sheet1?.data?.[i]?.[9] || null;
            const entryExitCk = sheet1?.data?.[i]?.[10] || null;
            const wiCk = sheet1?.data?.[i]?.[11] || null;
            const hvCk = sheet1?.data?.[i]?.[12] || null;
            const sgCk = sheet1?.data?.[i]?.[13] || null;
            const day1Ck = sheet1?.data?.[i]?.[14] || null;
            const day2Ck = sheet1?.data?.[i]?.[15] || null;
            const day3Ck = sheet1?.data?.[i]?.[16] || null;
            const day4Ck = sheet1?.data?.[i]?.[17] || null;
            const day5Ck = sheet1?.data?.[i]?.[18] || null;
            const day6Ck = sheet1?.data?.[i]?.[19] || null;
            const day7Ck = sheet1?.data?.[i]?.[20] || null;

            // old เก็บไว้
            if (i > 3) {
              if (
                day1Ck ||
                day2Ck ||
                day3Ck ||
                day4Ck ||
                day5Ck ||
                day6Ck ||
                day7Ck
              ) {
                flagEmtry = false;
              }

              fullDataRow.push({
                ix: i,
                row: sheet1?.data?.[i],
              });

              const checkNominationPoint = nominationPoint?.find((fnp: any) => {
                return fnp?.nomination_point === pointIdCk;
              });
              if (areaCk && !checkNominationPoint) {
                console.log('4 Nomination Point is incorrect.');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: `Nomination Point is incorrect.`, // https://sharing.clickup.com//9018502823/t/h/86euxnaeg/SFVBI9PW12U844A
                  },
                  HttpStatus.FORBIDDEN,
                );
              }
              if (typeCk === 'NONTPA') {
                const checkNonTPA = nonTpa.find((fn: any) => {
                  return fn?.non_tpa_point_name === pointIdCk;
                });
                if (checkNonTPA) {
                  if (checkNonTPA?.nomination_point) {
                    // ถ้าตรงทั้งหมดไปหาว่า Nomination Point นี้ใช้ Zone , Area, Entry/Exit และ Contract Point ที่มีอยู่ในสัญญาหรือไม่
                    let checkNom = false;
                    for (
                      let ifb = 0;
                      ifb <
                      (contractCode?.booking_version?.[0]?.booking_row_json || [])
                        .length;
                      ifb++
                    ) {
                      const findPoint =
                        checkNonTPA?.nomination_point?.contract_point_list.find(
                          (inb: any) => {
                            return (
                              inb?.contract_point ===
                              contractCode?.booking_version?.[0]
                                ?.booking_row_json?.[ifb]?.contract_point
                            );
                          },
                        );
                      if (findPoint) {
                        if (
                          findPoint?.area?.name ===
                          checkNonTPA?.nomination_point?.area?.name &&
                          findPoint?.zone?.name ===
                          checkNonTPA?.nomination_point?.zone?.name &&
                          findPoint?.entry_exit?.name ===
                          checkNonTPA?.nomination_point?.entry_exit?.name
                        ) {
                          checkNom = true;
                        }
                      }
                    }
                    if (checkNom) {
                      caseData?.columnType.push({
                        ix: i,
                        row: sheet1?.data?.[i],
                      });
                    } else {
                      console.log('-');
                      throw new HttpException(
                        {
                          status: HttpStatus.FORBIDDEN,
                          error: `${checkNonTPA?.nomination_point?.nomination_point || 'Nomination Point'} is not found in file for ${sheet1?.data?.[i]?.[3]}`,
                        },
                        HttpStatus.FORBIDDEN,
                      );
                    }
                  } else {
                    console.log('-1');
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        error: `${checkNonTPA?.nomination_point?.nomination_point || 'Nomination Point'} is not found in file for ${sheet1?.data?.[i]?.[3]}`,
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  }
                } else {
                  console.log('-3');
                  throw new HttpException(
                    {
                      status: HttpStatus.FORBIDDEN,
                      // error: `${checkNonTPA?.nomination_point?.nomination_point || "Nomination Point"} is not found in file for ${sheet1?.data?.[i]?.[3]}`,
                      error: `${sheet1?.data?.[i]?.[3]} is  not activated on Gas Day in the file.`,
                    },
                    HttpStatus.FORBIDDEN,
                  );
                }
              } else if (checkNominationPoint) {
                // ใช่ nom
                const supdemCk = supplyDemandCk === 'Supply' ? 'Entry' : 'Exit';
                if (
                  areaCk === checkNominationPoint?.area?.name &&
                  zoneCk === checkNominationPoint?.zone?.name &&
                  supdemCk === checkNominationPoint?.entry_exit?.name
                ) {
                  let checkNom = false;
                  for (
                    let ifb = 0;
                    ifb <
                    (contractCode?.booking_version?.[0]?.booking_row_json || [])
                      .length;
                    ifb++
                  ) {
                    const findPoint =
                      checkNominationPoint?.contract_point_list.find(
                        (inb: any) => {
                          return (
                            inb?.contract_point ===
                            contractCode?.booking_version?.[0]?.booking_row_json?.[
                              ifb
                            ]?.contract_point
                          );
                        },
                      );
                    if (findPoint) {
                      if (
                        findPoint?.area?.name ===
                        checkNominationPoint?.area?.name &&
                        findPoint?.zone?.name ===
                        checkNominationPoint?.zone?.name &&
                        findPoint?.entry_exit?.name ===
                        checkNominationPoint?.entry_exit?.name
                      ) {
                        checkNom = true;
                      }
                    }
                  }

                  if (checkNom) {
                    // non ปกติ
                    caseData?.columnPointId.push({
                      ix: i,
                      row: sheet1?.data?.[i],
                    });
                  } else {
                    console.log('-3');
                    console.log('areaCk : ', areaCk);
                    console.log('zoneCk : ', zoneCk);
                    console.log('supdemCk : ', supdemCk);
                    console.log(
                      'checkNominationPoint : ',
                      checkNominationPoint,
                    );
                    console.log('contractCode : ', contractCode);

                    console.log('5 Nomination Point is incorrect.');
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                        // error: `${areaCk}, ${zoneCk}, or ${supdemCk} for ${sheet1?.data?.[i]?.[3]}  is incorrected`,
                        error: `Nomination Point is incorrect.`, // https://app.clickup.com/t/86etzcgzh
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  }
                } else {
                  // ถ้าไม่ตรง
                  console.log('-4');
                  throw new HttpException(
                    {
                      status: HttpStatus.FORBIDDEN,
                      // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                      error: `${areaCk}, ${zoneCk}, or ${supdemCk} for ${sheet1?.data?.[i]?.[3]}  is incorrected`,
                    },
                    HttpStatus.FORBIDDEN,
                  );
                }
              } else {
                // ไม่ใช่ nom
                console.log('!!sheet1?.data?.[i]?.[0]  ; ', !!sheet1?.data?.[i]?.[0]);
                console.log('conceptPoint : ', conceptPoint);
                if (!!sheet1?.data?.[i]?.[0] && !!sheet1?.data?.[i]?.[3]) {
                  const findConcept = conceptPoint?.find((f: any) => {
                    return f?.concept_point === sheet1?.data?.[i]?.[3];
                  });

                  if (!findConcept) {
                    console.log(sheet1?.data?.[i]?.[3]);
                    console.log('2 Concept Point is inactivated.');
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        // error: `${sheet1?.data?.[i]?.[3]} is incorrected`,
                        // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                        error: `Concept Point is inactivated.`,
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  } else if (
                    !findConcept?.limit_concept_point?.find(
                      (f: any) => f?.group?.id_name === shipper?.id_name,
                    )
                  ) {
                    throw new HttpException(
                      {
                        status: HttpStatus.FORBIDDEN,
                        // error: `${sheet1?.data?.[i]?.[3]} is incorrected`,
                        // error: `${sheet1?.data?.[i]?.[3]} is activated for ${startDateEx} Click to continune`,
                        error: `No permission for this Concept Point ${sheet1?.data?.[i]?.[3]} ,Please set the limit first.`, // https://app.clickup.com/t/86etzch1z // https://app.clickup.com/t/86etzcgza
                      },
                      HttpStatus.FORBIDDEN,
                    );
                  }
                  caseData?.columnPointIdConcept.push({
                    ix: i,
                    row: sheet1?.data?.[i],
                  });
                } else {
                  caseData?.columnOther.push({
                    ix: i,
                    row: sheet1?.data?.[i],
                  });
                }
              }
            }
          }

          for (let i = 0; i < sheet2?.data.length; i++) {
            const zoneCk = sheet2?.data?.[i]?.[0] || null;
            const pointIdCk = sheet2?.data?.[i]?.[1] || null;

            if (i > 0 && !!zoneCk && !!pointIdCk) {
              const ckContractPoint =
                await this.prisma.nomination_point.findFirst({
                  where: {
                    zone: {
                      name: zoneCk,
                    },
                    nomination_point: pointIdCk,
                  },
                });
              if (ckContractPoint) {
                getsValueSheet2.push({
                  ix: i,
                  row: sheet1?.data?.[i],
                });
              }
            }
          }
        }
      }
    } else {
      if (!!checkType && !!sheet2) {
        console.log('8');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'type ไม่ตรง & ไม่พบ Sheet 2',
            error: 'File template does not match the required format.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (checkType) {
        console.log('9');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'type ไม่ตรง',
            error: 'File template does not match the required format.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        console.log('10');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            // error: 'ไม่พบ Sheet 2',
            error: 'File template does not match the required format.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (flagEmtry) {
      //https://app.clickup.com/t/86euxv3c8
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error:
            'Invalid File : Values are missing. Please provide at least one valid entry',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // มี template
    console.log('********* start *********');

    const bookingFullJson = this.safeParseJSON(
      contractCode?.booking_version?.[0]?.booking_full_json?.[0]?.data_temp,
    );
    const headerEntryCDBMMBTUD =
      bookingFullJson?.headerEntry?.['Capacity Daily Booking (MMBTU/d)'];
    delete headerEntryCDBMMBTUD['key'];
    const headerExitCDBMMBTUD =
      bookingFullJson?.headerExit?.['Capacity Daily Booking (MMBTU/d)'];
    delete headerExitCDBMMBTUD['key'];

    const headerEntryCDBMMBTUH =
      bookingFullJson?.headerEntry?.['Maximum Hour Booking (MMBTU/h)'];
    delete headerEntryCDBMMBTUH['key'];
    const headerExitCDBMMBTUH =
      bookingFullJson?.headerExit?.['Maximum Hour Booking (MMBTU/h)'];
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
              { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
      },
      include: {
        zone_master_quality: true,
        contract_point: true,
      },
    });
    let checksValue: any = [];
    let warningLogHrTemp: any = [];
    const warningLogHr: any = [];
    const warningLogDay: any = [];
    const warningLogDayWeek: any = [];
    const sheet1Quality: any = [];
    const sheet2Quality: any = [];

    getsValue = [...caseData?.columnPointId];

    const checkEmtry = getsValue?.map((re: any) =>
      re?.row?.map((rer: any) => false),
    );

    // sheet 1 check
    if (nomination_type_id === 1) {
      // daily
      if (filePeriodMode === 1 || filePeriodMode === 3) {
        console.log('dddddddddd');
        // day
        console.log('day');
        console.log('startDateExConv : ', startDateExConv);
        console.log('headerEntryCDBMMBTUH : ', headerEntryCDBMMBTUH);
        const resultEntryExitUse = this.findExactMatchingKeyDDMMYYYY(
          startDateExConv,
          headerEntryCDBMMBTUH,
        );
        const resultEntryExitUsePerDay = this.findExactMatchingKeyDDMMYYYY(
          startDateExConv,
          headerEntryCDBMMBTUD,
        );
        console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);
        console.log('✅ Key ที่ตรงกัน:', resultEntryExitUsePerDay);
        if (!resultEntryExitUse || !resultEntryExitUsePerDay) {
          throw new HttpException(
            {
              status: HttpStatus.FORBIDDEN,
              error: 'Nomination Point does not match the Contract Code.',
            },
            HttpStatus.FORBIDDEN,
          );
        }

        checksValue = getsValue.map((e: any, cI: any) => {
          const entryQuality = null;
          const overuseQuantity = null;
          const overMaximumHourCapacityRight = null;
          let valueCapa = 0;
          let valueCapaPerDay = 0;
          // e[9]["MMBTU/D"]
          if (e?.['row']?.[10] === 'Entry' && e?.['row']?.[9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e?.['row']?.[3];
            });
            // console.log('entryValue : ', entryValue);
            const find = entryValue?.find((f: any) => {
              return (
                f?.['0'] ===
                checkNominationPoint?.contract_point_list?.find((cl: any) => {
                  return cl?.contract_point === f?.['0'];
                })?.contract_point
              );
            });
            // console.log('find : ', find);
            // console.log('resultEntryExitUse : ', resultEntryExitUse);
            // const find = entryValue.find((f:any) => { return f['0'] ===  e['row'][3] })
            // valueCapa = !!find && !!resultEntryExitUse && find[resultEntryExitUse] || 0
            valueCapa =
              find?.[resultEntryExitUse] === '0' || !!find?.[resultEntryExitUse]
                ? find?.[resultEntryExitUse]
                : null; // new
            valueCapaPerDay =
              find?.[resultEntryExitUsePerDay] === '0' ||
                !!find?.[resultEntryExitUsePerDay]
                ? find?.[resultEntryExitUsePerDay]
                : null; // new

            // ตรวจสอบค่าความจุในช่วงเวลา 24 ชั่วโมง (index 14 ถึง 37)

            Array.from({ length: 24 }, (_, i) => i + 14).forEach((index) => {
              //
              const currentCapacity =
                e?.['row']?.[index] === '0' ||
                (!!e?.['row']?.[index] &&
                  Number(e?.['row']?.[index]?.trim()?.replace(/,/g, '') || 0)) ||
                null; //new
              const rIndex =
                e?.['row']?.[index] === '0' || !!e?.['row']?.[index]
                  ? e?.['row']?.[index]
                  : null;
              if (
                (valueCapa === null || valueCapaPerDay === null) &&
                !!rIndex
              ) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }

              if (e['row'][index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e['row'][index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Daily Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Daily Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // if (valueCapa === null && rIndex !== null) { //new
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: `Nomination Point does not match the Contract Code.`,
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // ถ้าค่าปัจจุบันเกินขีดจำกัด
              // console.log('currentCapacity : ', currentCapacity);
              // console.log('valueCapa : ', Number(valueCapa || 0));
              if (
                currentCapacity !== null &&
                !!valueCapa &&
                !!valueCapaPerDay
              ) {
                // overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                const finds = warningLogHrTemp?.find((f: any) => {
                  return (
                    f?.nomination_point === e['row'][3] &&
                    f?.hr === index - 14 + 1 &&
                    f?.contractPoint ===
                    checkNominationPoint?.contract_point_list.find(
                      (cl: any) => {
                        return cl?.contract_point === find['0'];
                      },
                    )?.contract_point
                  );
                });
                if (finds) {
                  warningLogHrTemp = warningLogHrTemp?.map((ehr: any) => {
                    const neHR = ehr;
                    if (
                      finds?.hr === neHR?.hr &&
                      finds?.contractPoint === neHR?.contractPoint &&
                      finds?.nomination_point === ehr?.nomination_point
                    ) {
                      neHR.energy = +Number(currentCapacity || 0);
                    }
                    return {
                      ...neHR,
                    };
                  });
                } else {
                  warningLogHrTemp.push({
                    nomination_point: e['row'][3],
                    hr: index - 14 + 1,
                    contractPoint:
                      checkNominationPoint?.contract_point_list.find(
                        (cl: any) => {
                          return cl?.contract_point === find['0'];
                        },
                      )?.contract_point,
                    value: Number(valueCapa || 0),
                    valueDay: Number(valueCapaPerDay || 0),
                    energy: currentCapacity,
                  });
                }
              }

              // if (currentCapacity !== null && Number(currentCapacity || 0) > Number(valueCapa || 0)) {
              //   overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
              //   warningLogHr.push(`Nominated max energy ${currentCapacity} exceeds contracted value ${Number(valueCapa)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point || "-"} and hour ${index - 14 + 1}`);
              // }
            });
            // const sumValuesDaily = Array.from({ length: 24 }, (_, i) => i + 14).reduce((sum, index) => {
            //   return sum + (Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0); // บวกค่า ถ้าเป็น undefined ให้ใช้ 0
            // }, 0);

            // if (sumValuesDaily > Number(valueCapa || 0)) {
            //   overuseQuantity = true
            //   // warningLogDay.push(`Nominated energy ${sumValuesDaily && this.formatNumberThreeDecimal(sumValuesDaily) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${e['row'][3]} and gas day ${startDateEx}`);
            //   warningLogDay.push(`Nominated Total energy ${sumValuesDaily && this.formatNumberThreeDecimal(sumValuesDaily) || 0} exceeds contracted value ${Number(valueCapaPerDay)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point} and gas day ${startDateEx}`);
            // }

            const findZone = zoneQualityMaster.find((f: any) => {
              return f?.name === e['row'][0] && f?.entry_exit_id === 1;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );

            // WI
            if (
              Number(e['row'][11] || 0) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min || 0) ||
              Number(e['row'][11] || 0) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max || 0)
            ) {
              e['row'][11] !== null &&
                e['row'][11] !== '' &&
                e['row'][11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, WI value (${Number(e['row'][11] || 0)}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min || 0)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max || 0)})`,
                );
            }
            // HV
            if (
              Number(e['row'][12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e['row'][12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e['row'][12] !== null &&
                e['row'][12] !== '' &&
                e['row'][12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, HV value (${Number(e['row'][12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          } else if (e['row'][10] === 'Exit' && e['row'][9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e['row'][3];
            });
            const find = exitValue.find((f: any) => {
              return (
                f['0'] ===
                checkNominationPoint?.contract_point_list.find((cl: any) => {
                  return cl?.contract_point === f['0'];
                })?.contract_point
              );
            });
            // const find = exitValue.find((f:any) => { return f['0'] ===  e['row'][3] })
            // valueCapa = !!find && !!resultEntryExitUse && find[resultEntryExitUse] || 0
            valueCapa =
              find[resultEntryExitUse] === '0' || !!find[resultEntryExitUse]
                ? find[resultEntryExitUse]
                : null; // new
            valueCapaPerDay =
              find[resultEntryExitUsePerDay] === '0' ||
                !!find[resultEntryExitUsePerDay]
                ? find[resultEntryExitUsePerDay]
                : null; // new
            // ตรวจสอบค่าความจุในช่วงเวลา 24 ชั่วโมง (index 14 ถึง 37)
            Array.from({ length: 24 }, (_, i) => i + 14).forEach((index) => {
              const currentCapacity =
                e['row'][index] === '0' ||
                (!!e['row'][index] &&
                  Number(e['row'][index]?.trim()?.replace(/,/g, ''))) ||
                null; //new
              const rIndex =
                e['row'][index] === '0' || !!e['row'][index]
                  ? e['row'][index]
                  : null;
              if (valueCapa === null && !!rIndex) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }

              if (e['row'][index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e['row'][index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Daily Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Daily Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // if (valueCapa === null && rIndex !== null) { //new
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: `Nomination Point does not match the Contract Code.`,
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // Weekly Nomination File must contain values.

              // ถ้าค่าปัจจุบันเกินขีดจำกัด
              if (
                currentCapacity !== null &&
                !!valueCapa &&
                !!valueCapaPerDay
              ) {
                // overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                const finds = warningLogHrTemp?.find((f: any) => {
                  return (
                    f?.nomination_point === e['row'][3] &&
                    f?.hr === index - 14 + 1 &&
                    f?.contractPoint ===
                    checkNominationPoint?.contract_point_list.find(
                      (cl: any) => {
                        return cl?.contract_point === find['0'];
                      },
                    )?.contract_point
                  );
                });
                if (finds) {
                  warningLogHrTemp = warningLogHrTemp?.map((ehr: any) => {
                    const neHR = ehr;
                    if (
                      finds?.hr === neHR?.hr &&
                      finds?.contractPoint === neHR?.contractPoint &&
                      finds?.nomination_point === ehr?.nomination_point
                    ) {
                      neHR.energy = +Number(currentCapacity);
                    }
                    return {
                      ...neHR,
                    };
                  });
                } else {
                  warningLogHrTemp.push({
                    nomination_point: e['row'][3],
                    hr: index - 14 + 1,
                    contractPoint:
                      checkNominationPoint?.contract_point_list.find(
                        (cl: any) => {
                          return cl?.contract_point === find['0'];
                        },
                      )?.contract_point,
                    value: Number(valueCapa),
                    valueDay: Number(valueCapaPerDay),
                    energy: currentCapacity,
                  });
                }
              }
              // if (currentCapacity !== null && Number(currentCapacity) > Number(valueCapa)) {
              //   overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
              //   warningLogHr.push(`Nominated max energy ${currentCapacity} exceeds contracted value ${Number(valueCapa)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point || "-"} and hour ${index - 14 + 1}`);
              // }
            });
            // const sumValuesDaily = Array.from({ length: 24 }, (_, i) => i + 14).reduce((sum, index) => {
            //   return sum + (Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0); // บวกค่า ถ้าเป็น undefined ให้ใช้ 0
            // }, 0);
            // if (sumValuesDaily > Number(valueCapa)) {
            //   overuseQuantity = true
            //   warningLogDay.push(`Nominated Total energy ${sumValuesDaily && this.formatNumberThreeDecimal(sumValuesDaily) || 0} exceeds contracted value ${Number(valueCapaPerDay)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point || "-"} and gas day ${startDateEx}`);
            // }
            const findZone = zoneQualityMaster.find((f: any) => {
              return f?.name === e['row'][0] && f?.entry_exit_id === 2;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );

            // WI
            if (
              Number(e['row'][11]) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min) ||
              Number(e['row'][11]) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)
            ) {
              e['row'][11] !== null &&
                e['row'][11] !== '' &&
                e['row'][11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, WI value (${Number(e['row'][11])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)})`,
                );
            }
            // HV
            if (
              Number(e['row'][12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e['row'][12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e['row'][12] !== null &&
                e['row'][12] !== '' &&
                e['row'][12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, HV value (${Number(e['row'][12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          }

          return {
            ...e,
            entryQuality: entryQuality,
            overuseQuantity: overuseQuantity,
            overMaximumHourCapacityRight: overMaximumHourCapacityRight,
            bookValue: { date: startDateEx, value: Number(valueCapa) },
            unit: e['row'][9],
            entryExitText: e['row'][10],
            zoneText: e['row'][0],
            areaText: e['row'][2],
            contractPointText: e['row'][3],
          };
        });
      } else {
        console.log('mmmmmmmmmm');
        // month
        console.log('month');
        const resultEntryExitUse = this.findMatchingKeyMMYYYY(
          startDateExConv,
          headerEntryCDBMMBTUH,
        );
        const resultEntryExitUsePerDay = this.findMatchingKeyMMYYYY(
          startDateExConv,
          headerEntryCDBMMBTUD,
        );
        console.log('startDateExConv : ', startDateExConv);
        console.log('headerEntryCDBMMBTUH : ', headerEntryCDBMMBTUH);
        console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);
        console.log('✅ Key ที่ตรงกัน:', resultEntryExitUsePerDay);
        if (!resultEntryExitUse || !resultEntryExitUsePerDay) {
          throw new HttpException(
            {
              status: HttpStatus.FORBIDDEN,
              error: 'Nomination Point does not match the Contract Code.',
            },
            HttpStatus.FORBIDDEN,
          );
        }

        checksValue = getsValue.map((e: any, cI: any) => {
          const entryQuality = null;
          const overuseQuantity = null;
          const overMaximumHourCapacityRight = null;
          let valueCapa = 0;
          let valueCapaPerDay = 0;
          if (e?.['row']?.[10] === 'Entry' && e?.['row']?.[9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e?.['row']?.[3];
            });
            const find = entryValue?.find((f: any) => {
              return (
                f?.['0'] ===
                checkNominationPoint?.contract_point_list?.find((cl: any) => {
                  return cl?.contract_point === f?.['0'];
                })?.contract_point
              );
            });
            // const find = { //test
            //     '0': 'ENTRY-X1-EGAT',
            //     '5': '24/08/2025',
            //     '6': '24/11/2025',
            //     '7': '5000',
            //     '8': '5000',
            //     '9': '5000',
            //     '10': '5000',
            //     '11': '229.167',
            //     '12': '',
            //     // '12': '229.167',
            //     '13': '229.167',
            //     '14': '229.167',
            //     '15': '5',
            //     '16': '5',
            //     '17': '5',
            //     '18': '5',
            //     '19': '0.229167',
            //     '20': '0.229167',
            //     '21': '0.229167',
            //     '22': '0.229167'
            //   }
            // valueCapa = (!!find && !!resultEntryExitUse) && find[resultEntryExitUse] || 0
            valueCapa =
              find?.[resultEntryExitUse] === '0' || !!find?.[resultEntryExitUse]
                ? find?.[resultEntryExitUse]
                : null; // new
            valueCapaPerDay =
              find?.[resultEntryExitUsePerDay] === '0' ||
                !!find?.[resultEntryExitUsePerDay]
                ? find?.[resultEntryExitUsePerDay]
                : null; // new
            // console.log('find : ', find);
            // console.log('resultEntryExitUse : ', resultEntryExitUse);
            Array.from({ length: 24 }, (_, i) => i + 14).forEach((index) => {
              const currentCapacity =
                e?.['row']?.[index] === '0' ||
                (!!e?.['row']?.[index] &&
                  Number(e?.['row']?.[index]?.trim()?.replace(/,/g, ''))) ||
                null; //new
              const rIndex =
                e?.['row']?.[index] === '0' || !!e?.['row']?.[index]
                  ? e?.['row']?.[index]
                  : null;
              if (valueCapa === null && !!rIndex) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }

              if (e?.['row']?.[index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e?.['row']?.[index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Daily Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Daily Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }
              // console.log('valueCapa : ', valueCapa);
              // console.log('currentCapacity : ', currentCapacity);
              // if (valueCapa === null && rIndex !== null) { //new
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: `Nomination Point does not match the Contract Code.`,
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }
              // if (!!!valueCapa && currentCapacity === null) {
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: `${e['row'][3]} is incorrect`,
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // Weekly Nomination File must contain values.

              // ถ้าค่าปัจจุบันเกินขีดจำกัด
              if (
                currentCapacity !== null &&
                !!valueCapa &&
                !!valueCapaPerDay
              ) {
                // overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                const finds = warningLogHrTemp?.find((f: any) => {
                  return (
                    f?.nomination_point === e['row'][3] &&
                    f?.hr === index - 14 + 1 &&
                    f?.contractPoint ===
                    checkNominationPoint?.contract_point_list.find(
                      (cl: any) => {
                        return cl?.contract_point === find['0'];
                      },
                    )?.contract_point
                  );
                });
                if (finds) {
                  warningLogHrTemp = warningLogHrTemp?.map((ehr: any) => {
                    const neHR = ehr;
                    if (
                      finds?.hr === neHR?.hr &&
                      finds?.contractPoint === neHR?.contractPoint &&
                      finds?.nomination_point === ehr?.nomination_point
                    ) {
                      neHR.energy = +Number(currentCapacity);
                    }
                    return {
                      ...neHR,
                    };
                  });
                } else {
                  warningLogHrTemp.push({
                    nomination_point: e?.['row']?.[3],
                    hr: index - 14 + 1,
                    contractPoint:
                      checkNominationPoint?.contract_point_list?.find(
                        (cl: any) => {
                          return cl?.contract_point === find?.['0'];
                        },
                      )?.contract_point,
                    value: Number(valueCapa),
                    valueDay: Number(valueCapaPerDay),
                    energy: currentCapacity,
                  });
                }
              }
              // if (currentCapacity !== null && Number(currentCapacity) > Number(valueCapa)) {
              //   overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
              //   warningLogHr.push(`Nominated max energy ${currentCapacity} exceeds contracted value ${Number(valueCapa)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point || "-"} and hour ${index - 14 + 1}`);
              // }
            });
            // const sumValuesDaily = Array.from({ length: 24 }, (_, i) => i + 14).reduce((sum, index) => {
            //   return sum + (Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0); // บวกค่า ถ้าเป็น undefined ให้ใช้ 0
            // }, 0);
            // if (sumValuesDaily > Number(valueCapa)) {
            //   overuseQuantity = true
            //   warningLogDay.push(`Nominated Total energy ${sumValuesDaily && this.formatNumberThreeDecimal(sumValuesDaily) || 0} exceeds contracted value ${Number(valueCapaPerDay)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point || "-"} and gas day ${startDateEx}`);
            // }

            const findZone = zoneQualityMaster.find((f: any) => {
              return f?.name === e['row'][0] && f?.entry_exit_id === 1;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );
            //  console.log('findZone : ', findZone);
            //  console.log('zone_master_quality : ', findZone?.zone_master_quality?.[0]);

            // WI
            if (
              Number(e['row'][11]) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min) ||
              Number(e['row'][11]) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)
            ) {
              e['row'][11] !== null &&
                e['row'][11] !== '' &&
                e['row'][11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, WI value (${Number(e['row'][11])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)})`,
                );
            }
            // HV
            if (
              Number(e['row'][12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e['row'][12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e['row'][12] !== null &&
                e['row'][12] !== '' &&
                e['row'][12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, HV value (${Number(e['row'][12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          } else if (e['row'][10] === 'Exit' && e['row'][9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e['row'][3];
            });
            const find = exitValue.find((f: any) => {
              return (
                f['0'] ===
                checkNominationPoint?.contract_point_list.find((cl: any) => {
                  return cl?.contract_point === f['0'];
                })?.contract_point
              );
            });
            // const find = exitValue.find((f:any) => { return f['0'] ===  e['row'][3] })
            // valueCapa = (!!find && !!resultEntryExitUse) && find[resultEntryExitUse] || 0
            valueCapa =
              find?.[resultEntryExitUse] === '0' || !!find?.[resultEntryExitUse]
                ? find?.[resultEntryExitUse]
                : null; // new
            valueCapaPerDay =
              find?.[resultEntryExitUsePerDay] === '0' ||
                !!find?.[resultEntryExitUsePerDay]
                ? find?.[resultEntryExitUsePerDay]
                : null; // new
            Array.from({ length: 24 }, (_, i) => i + 14).forEach((index) => {
              const currentCapacity =
                e?.['row']?.[index] === '0' ||
                (!!e?.['row']?.[index] &&
                  Number(e?.['row']?.[index]?.trim()?.replace(/,/g, ''))) ||
                null; //new
              const rIndex =
                e?.['row']?.[index] === '0' || !!e?.['row']?.[index]
                  ? e?.['row']?.[index]
                  : null;
              if (valueCapa === null && !!rIndex) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }

              if (e?.['row']?.[index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e['row'][index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Daily Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Daily Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // if (valueCapa === null && rIndex !== null) { //new
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: `Nomination Point does not match the Contract Code.`,
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // Weekly Nomination File must contain values.

              // ถ้าค่าปัจจุบันเกินขีดจำกัด
              if (
                currentCapacity !== null &&
                !!valueCapa &&
                !!valueCapaPerDay
              ) {
                // overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                const finds = warningLogHrTemp?.find((f: any) => {
                  return (
                    f?.nomination_point === e?.['row']?.[3] &&
                    f?.hr === index - 14 + 1 &&
                    f?.contractPoint ===
                    checkNominationPoint?.contract_point_list?.find(
                      (cl: any) => {
                        return cl?.contract_point === find?.['0'];
                      },
                    )?.contract_point
                  );
                });
                if (finds) {
                  warningLogHrTemp = warningLogHrTemp?.map((ehr: any) => {
                    const neHR = ehr;
                    if (
                      finds?.hr === neHR?.hr &&
                      finds?.contractPoint === neHR?.contractPoint &&
                      finds?.nomination_point === ehr?.nomination_point
                    ) {
                      neHR.energy = +Number(currentCapacity);
                    }
                    return {
                      ...neHR,
                    };
                  });
                } else {
                  warningLogHrTemp.push({
                    nomination_point: e?.['row']?.[3],
                    hr: index - 14 + 1,
                    contractPoint:
                      checkNominationPoint?.contract_point_list?.find(
                        (cl: any) => {
                          return cl?.contract_point === find?.['0'];
                        },
                      )?.contract_point,
                    value: Number(valueCapa),
                    valueDay: Number(valueCapaPerDay),
                    energy: currentCapacity,
                  });
                }
              }
              // if (currentCapacity !== null && Number(currentCapacity) > Number(valueCapa)) {
              //   overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
              //   warningLogHr.push(`Nominated max energy ${currentCapacity} exceeds contracted value ${Number(valueCapa)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point || "-"} and hour ${index - 14 + 1}`);
              // }
            });
            // const sumValuesDaily = Array.from({ length: 24 }, (_, i) => i + 14).reduce((sum, index) => {
            //   return sum + (Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0); // บวกค่า ถ้าเป็น undefined ให้ใช้ 0
            // }, 0);
            // if (sumValuesDaily > Number(valueCapa)) {
            //   overuseQuantity = true
            //   // warningLogDay.push(`Nominated energy ${sumValuesDaily && this.formatNumberThreeDecimal(sumValuesDaily) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${e['row'][3]} and gas day ${startDateEx}`);
            //   warningLogDay.push(`Nominated Total energy ${sumValuesDaily && this.formatNumberThreeDecimal(sumValuesDaily) || 0} exceeds contracted value ${Number(valueCapaPerDay)} for contract point ${(checkNominationPoint?.contract_point_list.find((cl: any) => { return cl?.contract_point === find['0'] }))?.contract_point || "-"} and gas day ${startDateEx}`);
            // }

            const findZone = zoneQualityMaster?.find((f: any) => {
              return f?.name === e?.['row']?.[0] && f?.entry_exit_id === 2;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );

            // WI
            if (
              Number(e?.['row']?.[11]) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min) ||
              Number(e?.['row']?.[11]) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)
            ) {
              e?.['row']?.[11] !== null &&
                e?.['row']?.[11] !== '' &&
                e?.['row']?.[11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e?.['row']?.[3]}, WI value (${Number(e?.['row']?.[11])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)})`,
                );
            }
            // HV
            if (
              Number(e?.['row']?.[12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e?.['row']?.[12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e?.['row']?.[12] !== null &&
                e?.['row']?.[12] !== '' &&
                e?.['row']?.[12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e?.['row']?.[3]}, HV value (${Number(e?.['row']?.[12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          }

          return {
            ...e,
            entryQuality: entryQuality,
            overuseQuantity: overuseQuantity,
            overMaximumHourCapacityRight: overMaximumHourCapacityRight,
            bookValue: { date: startDateEx, value: Number(valueCapa) },
            unit: e['row'][9],
            entryExitText: e['row'][10],
            zoneText: e['row'][0],
            areaText: e['row'][2],
            contractPointText: e['row'][3],
          };
        });
      }
    } else {
      let weekBook = true;
      // weekly
      if (filePeriodMode === 1 || filePeriodMode === 3) {
        // day
        // const resultEntryExitUse = this.findExactMatchingKeyDDMMYYYY(startDateExConv, headerEntryCDBMMBTUD);
        // console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);
        const headDay = sheet1?.data?.[3];
        checksValue = getsValue.map((e: any, cI: any) => {
          const entryQuality = null;
          const overuseQuantity = null;
          let overMaximumHourCapacityRight = null;
          let valueCapa = 0;
          const valueCapaArr = [];

          if (e?.['row']?.[10] === 'Entry' && e?.['row']?.[9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e?.['row']?.[3];
            });
            const find = entryValue?.find((f: any) => {
              return (
                f?.['0'] ===
                checkNominationPoint?.contract_point_list?.find((cl: any) => {
                  return cl?.contract_point === f?.['0'];
                })?.contract_point
              );
            });
            // const find = entryValue.find((f:any) => { return f['0'] ===  e['row'][3] })
            // valueCapa = find[resultEntryExitUse] || 0
            // console.log('valueCapa : ', valueCapa);
            Array.from({ length: 7 }, (_, i) => i + 14).forEach((index) => {
              if (e['row'][index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e['row'][index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Weekly Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Weekly Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // const currentCapacity = Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0;
              const currentCapacity =
                e?.['row']?.[index] === '0' ||
                (!!e?.['row']?.[index] &&
                  Number(e?.['row']?.[index]?.trim()?.replace(/,/g, ''))) ||
                null; //new
              const headDayUse = headDay?.[index];
              const headDayUseConv = getTodayNowDDMMYYYYDfaultAdd7(headDayUse);
              const resultEntryExitUse = this.findExactMatchingKeyDDMMYYYY(
                headDayUseConv,
                headerEntryCDBMMBTUD,
              );
              if (resultEntryExitUse) {
                weekBook = false;
              }
              console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);
              // valueCapa = (!!find && !!resultEntryExitUse) && find[resultEntryExitUse] || 0
              valueCapa =
                find?.[resultEntryExitUse] === '0' || !!find?.[resultEntryExitUse]
                  ? find?.[resultEntryExitUse]
                  : null; // new
              valueCapaArr.push({ date: headDayUse, value: Number(valueCapa) });

              const rIndex =
                e?.['row']?.[index] === '0' || !!e?.['row']?.[index]
                  ? e?.['row']?.[index]
                  : null;
              if (valueCapa === null && !!rIndex) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }

              // if (!!!valueCapa && currentCapacity > 0) {
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: `${e['row'][3]} is incorrect`,
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // if (!!!valueCapa && (e['row'][index] !== "")) {
              //   console.log('Blank');
              //   console.log("b : ", valueCapa);
              //   console.log('n : ', e['row'][index]);
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Nomination Point does not match the Contract Code.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // // ถ้าค่าปัจจุบันเกินขีดจำกัด
              if (
                currentCapacity !== null &&
                Number(currentCapacity) > Number(valueCapa)
              ) {
                overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                // warningLogDayWeek.push(`Nominated energy ${currentCapacity && this.formatNumberThreeDecimal(currentCapacity) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${e['row'][3]} and gas day ${headDayUse}`);
                warningLogDayWeek.push(
                  `Nominated Total energy ${(currentCapacity && this.formatNumberThreeDecimal(currentCapacity)) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${checkNominationPoint?.contract_point_list?.find(
                    (cl: any) => {
                      return cl?.contract_point === find?.['0'];
                    },
                  )?.contract_point
                  } and gas day ${headDayUse}`,
                );
              }
            });
            const findZone = zoneQualityMaster?.find((f: any) => {
              return f?.name === e?.['row']?.[0] && f?.entry_exit_id === 1;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );
            //  console.log('findZone : ', findZone);
            //  console.log('zone_master_quality : ', findZone?.zone_master_quality?.[0]);

            // WI
            if (
              Number(e?.['row']?.[11]) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min) ||
              Number(e?.['row']?.[11]) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)
            ) {
              e?.['row']?.[11] !== null &&
                e?.['row']?.[11] !== '' &&
                e?.['row']?.[11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e?.['row']?.[3]}, WI value (${Number(e?.['row']?.[11])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)})`,
                );
            }
            // HV
            if (
              Number(e?.['row']?.[12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e?.['row']?.[12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e?.['row']?.[12] !== null &&
                e?.['row']?.[12] !== '' &&
                e?.['row']?.[12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e?.['row']?.[3]}, HV value (${Number(e?.['row']?.[12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          } else if (e?.['row']?.[10] === 'Exit' && e?.['row']?.[9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e?.['row']?.[3];
            });
            const find = exitValue?.find((f: any) => {
              return (
                f?.['0'] ===
                checkNominationPoint?.contract_point_list?.find((cl: any) => {
                  return cl?.contract_point === f?.['0'];
                })?.contract_point
              );
            });
            // const find = exitValue.find((f:any) => { return f['0'] ===  e['row'][3] })
            // valueCapa = find[resultEntryExitUse] || 0
            // console.log('valueCapa : ', valueCapa);
            Array.from({ length: 7 }, (_, i) => i + 14).forEach((index) => {
              if (e['row'][index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e['row'][index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Weekly Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Weekly Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }
              // const currentCapacity = Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0;
              const currentCapacity =
                e['row'][index] === '0' ||
                (!!e['row'][index] &&
                  Number(e['row'][index]?.trim()?.replace(/,/g, ''))) ||
                null; //new
              const headDayUse = headDay[index];
              const headDayUseConv = getTodayNowDDMMYYYYDfaultAdd7(headDayUse);
              const resultEntryExitUse = this.findExactMatchingKeyDDMMYYYY(
                headDayUseConv,
                headerEntryCDBMMBTUD,
              );
              if (resultEntryExitUse) {
                weekBook = false;
              }
              console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);
              // valueCapa = (!!find && !!resultEntryExitUse) && find[resultEntryExitUse] || 0
              valueCapa =
                find[resultEntryExitUse] === '0' || !!find[resultEntryExitUse]
                  ? find[resultEntryExitUse]
                  : null; // new
              valueCapaArr.push({ date: headDayUse, value: Number(valueCapa) });

              const rIndex =
                e['row'][index] === '0' || !!e['row'][index]
                  ? e['row'][index]
                  : null;
              if (valueCapa === null && !!rIndex) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }
              // if (!!!valueCapa && currentCapacity > 0) {
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: `${e['row'][3]} is incorrect`,
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }

              // if (!!!valueCapa && (e['row'][index] !== "")) {
              //   console.log('Blank');
              //   console.log("b : ", valueCapa);
              //   console.log('n : ', e['row'][index]);
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Nomination Point does not match the Contract Code.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }
              // // ถ้าค่าปัจจุบันเกินขีดจำกัด
              if (
                currentCapacity !== null &&
                Number(currentCapacity) > Number(valueCapa)
              ) {
                overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                // warningLogDayWeek.push(`Nominated energy ${currentCapacity && this.formatNumberThreeDecimal(currentCapacity) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${e['row'][3]} and gas day ${headDayUse}`);
                warningLogDayWeek.push(
                  `Nominated Total energy ${(currentCapacity && this.formatNumberThreeDecimal(currentCapacity)) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${checkNominationPoint?.contract_point_list.find(
                    (cl: any) => {
                      return cl?.contract_point === find['0'];
                    },
                  )?.contract_point
                  } and gas day ${headDayUse}`,
                );
              }
            });

            const findZone = zoneQualityMaster.find((f: any) => {
              return f?.name === e['row'][0] && f?.entry_exit_id === 2;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );
            //  console.log('findZone : ', findZone);
            //  console.log('zone_master_quality : ', findZone?.zone_master_quality?.[0]);

            // WI
            if (
              Number(e['row'][11]) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min) ||
              Number(e['row'][11]) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)
            ) {
              e['row'][11] !== null &&
                e['row'][11] !== '' &&
                e['row'][11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, WI value (${Number(e['row'][11])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)})`,
                );
            }
            // HV
            if (
              Number(e['row'][12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e['row'][12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e['row'][12] !== null &&
                e['row'][12] !== '' &&
                e['row'][12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, HV value (${Number(e['row'][12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          }

          return {
            ...e,
            entryQuality: entryQuality,
            overuseQuantity: overuseQuantity,
            overMaximumHourCapacityRight: overMaximumHourCapacityRight,
            bookValue: valueCapaArr,
            unit: e['row'][9],
            entryExitText: e['row'][10],
            zoneText: e['row'][0],
            areaText: e['row'][2],
            contractPointText: e['row'][3],
          };
        });
      } else {
        // month
        // startDateExConv
        const headDay = sheet1?.data?.[3];
        // const resultEntryExitUse = this.findMatchingKeyMMYYYY(startDateExConv, headerEntryCDBMMBTUD);
        // console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);

        checksValue = getsValue.map((e: any, cI: any) => {
          const entryQuality = null;
          const overuseQuantity = null;
          let overMaximumHourCapacityRight = null;
          let valueCapa = 0;
          const valueCapaArr = [];
          if (e['row'][10] === 'Entry' && e['row'][9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e['row'][3];
            });
            const find = entryValue.find((f: any) => {
              return (
                f['0'] ===
                checkNominationPoint?.contract_point_list.find((cl: any) => {
                  return cl?.contract_point === f['0'];
                })?.contract_point
              );
            });
            // const find = entryValue.find((f:any) => { return f['0'] ===  e['row'][3] })
            // valueCapa = find[resultEntryExitUse] || 0
            // console.log('valueCapa : ', valueCapa);
            Array.from({ length: 7 }, (_, i) => i + 14).forEach((index) => {
              if (e['row'][index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e['row'][index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Weekly Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Weekly Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }
              // const currentCapacity = Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0;
              const currentCapacity =
                e?.['row']?.[index] === '0' ||
                (!!e?.['row']?.[index] &&
                  Number(e?.['row']?.[index]?.trim()?.replace(/,/g, ''))) ||
                null; //new
              const headDayUse = headDay?.[index];
              const headDayUseConv = getTodayNowDDMMYYYYDfaultAdd7(headDayUse);
              const resultEntryExitUse = this.findMatchingKeyMMYYYY(
                headDayUseConv,
                headerEntryCDBMMBTUD,
              );
              if (resultEntryExitUse) {
                weekBook = false;
              }
              console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);
              // valueCapa = (!!find && !!resultEntryExitUse) && find[resultEntryExitUse] || 0
              valueCapa =
                find?.[resultEntryExitUse] === '0' || !!find?.[resultEntryExitUse]
                  ? find?.[resultEntryExitUse]
                  : null; // new

              valueCapaArr.push({ date: headDayUse, value: Number(valueCapa) });

              const rIndex =
                e?.['row']?.[index] === '0' || !!e?.['row']?.[index]
                  ? e?.['row']?.[index]
                  : null;
              if (valueCapa === null && !!rIndex) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }
              // // ถ้าค่าปัจจุบันเกินขีดจำกัด
              if (
                currentCapacity !== null &&
                Number(currentCapacity) > Number(valueCapa)
              ) {
                overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                // warningLogDayWeek.push(`Nominated energy ${currentCapacity && this.formatNumberThreeDecimal(currentCapacity) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${e['row'][3]} and gas day ${headDayUse}`);
                warningLogDayWeek.push(
                  `Nominated Total energy ${(currentCapacity && this.formatNumberThreeDecimal(currentCapacity)) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${checkNominationPoint?.contract_point_list?.find(
                    (cl: any) => {
                      return cl?.contract_point === find?.['0'];
                    },
                  )?.contract_point
                  } and gas day ${headDayUse}`,
                );
              }
            });

            const findZone = zoneQualityMaster?.find((f: any) => {
              return f?.name === e?.['row']?.[0] && f?.entry_exit_id === 1;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );
            //  console.log('findZone : ', findZone);
            //  console.log('zone_master_quality : ', findZone?.zone_master_quality?.[0]);

            // WI
            if (
              Number(e?.['row']?.[11]) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min) ||
              Number(e?.['row']?.[11]) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)
            ) {
              e?.['row']?.[11] !== null &&
                e?.['row']?.[11] !== '' &&
                e?.['row']?.[11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e?.['row']?.[3]}, WI value (${Number(e?.['row']?.[11])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)})`,
                );
            }
            // HV
            if (
              Number(e?.['row']?.[12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e?.['row']?.[12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e?.['row']?.[12] !== null &&
                e?.['row']?.[12] !== '' &&
                e?.['row']?.[12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e?.['row']?.[3]}, HV value (${Number(e?.['row']?.[12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          } else if (e?.['row']?.[10] === 'Exit' && e?.['row']?.[9] === 'MMBTU/D') {
            const checkNominationPoint = nominationPoint?.find((fnp: any) => {
              return fnp?.nomination_point === e?.['row']?.[3];
            });
            const find = exitValue?.find((f: any) => {
              return (
                f?.['0'] ===
                checkNominationPoint?.contract_point_list?.find((cl: any) => {
                  return cl?.contract_point === f?.['0'];
                })?.contract_point
              );
            });
            // const find = exitValue.find((f:any) => { return f['0'] ===  e['row'][3] })
            // valueCapa = find[resultEntryExitUse] || 0
            // console.log('valueCapa : ', valueCapa);
            Array.from({ length: 7 }, (_, i) => i + 14).forEach((index) => {
              if (e['row'][index]) {
                checkEmtry[cI][index] = true;
              }

              // https://app.clickup.com/t/86etrq2b6
              if (e['row'][index] === 0) {
                // throw new HttpException(
                //   {
                //     status: HttpStatus.FORBIDDEN,
                //     error: 'Weekly Nomination File must contain values.',
                //   },
                //   HttpStatus.FORBIDDEN,
                // );
              }
              // https://app.clickup.com/t/86et0vtjh
              // if(e['row'][index] !== 0 && !!!e['row'][index]){
              //   throw new HttpException(
              //     {
              //       status: HttpStatus.FORBIDDEN,
              //       error: 'Weekly Nomination File must contain values.',
              //     },
              //     HttpStatus.FORBIDDEN,
              //   );
              // }
              // const currentCapacity = Number(e['row'][index]?.trim()?.replace(/,/g, '')) || 0;
              const currentCapacity =
                e['row'][index] === '0' ||
                (!!e['row'][index] &&
                  Number(e['row'][index]?.trim()?.replace(/,/g, ''))) ||
                null; //new
              const headDayUse = headDay[index];
              const headDayUseConv = getTodayNowDDMMYYYYDfaultAdd7(headDayUse);
              const resultEntryExitUse = this.findMatchingKeyMMYYYY(
                headDayUseConv,
                headerEntryCDBMMBTUD,
              );
              if (resultEntryExitUse) {
                weekBook = false;
              }
              console.log('✅ Key ที่ตรงกัน:', resultEntryExitUse);
              // valueCapa = (!!find && !!resultEntryExitUse) && find[resultEntryExitUse] || 0
              valueCapa =
                find[resultEntryExitUse] === '0' || !!find[resultEntryExitUse]
                  ? find[resultEntryExitUse]
                  : null; // new
              valueCapaArr.push({ date: headDayUse, value: Number(valueCapa) });

              const rIndex =
                e['row'][index] === '0' || !!e['row'][index]
                  ? e['row'][index]
                  : null;
              if (valueCapa === null && !!rIndex) {
                console.log('Blank');
                throw new HttpException(
                  {
                    status: HttpStatus.FORBIDDEN,
                    error: 'Nomination Point does not match the Contract Code.',
                  },
                  HttpStatus.FORBIDDEN,
                );
              }
              // // ถ้าค่าปัจจุบันเกินขีดจำกัด
              if (
                currentCapacity !== null &&
                Number(currentCapacity) > Number(valueCapa)
              ) {
                overMaximumHourCapacityRight = true; // ตั้งค่าว่าเกินขีดจำกัด
                // warningLogDayWeek.push(`Nominated energy ${currentCapacity && this.formatNumberThreeDecimal(currentCapacity) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${e['row'][3]} and gas day ${headDayUse}`);
                warningLogDayWeek.push(
                  `Nominated Total energy ${(currentCapacity && this.formatNumberThreeDecimal(currentCapacity)) || 0} exceeds contracted value ${Number(valueCapa)} for contract point ${checkNominationPoint?.contract_point_list.find(
                    (cl: any) => {
                      return cl?.contract_point === find['0'];
                    },
                  )?.contract_point
                  } and gas day ${headDayUse}`,
                );
              }
            });

            const findZone = zoneQualityMaster.find((f: any) => {
              return f?.name === e['row'][0] && f?.entry_exit_id === 2;
            });
            console.log('-findZone : ', findZone);
            console.log(
              '-zone_master_quality : ',
              findZone?.zone_master_quality?.[0],
            );
            //  console.log('findZone : ', findZone);
            //  console.log('zone_master_quality : ', findZone?.zone_master_quality?.[0]);

            // WI
            if (
              Number(e['row'][11]) <
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min) ||
              Number(e['row'][11]) >
              Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)
            ) {
              e['row'][11] !== null &&
                e['row'][11] !== '' &&
                e['row'][11] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, WI value (${Number(e['row'][11])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_wobbe_index_max)})`,
                );
            }
            // HV
            if (
              Number(e['row'][12]) <
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min,
              ) ||
              Number(e['row'][12]) >
              Number(
                findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max,
              )
            ) {
              e['row'][12] !== null &&
                e['row'][12] !== '' &&
                e['row'][12] !== undefined &&
                sheet1Quality.push(
                  `For nomination point ${e['row'][3]}, HV value (${Number(e['row'][12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_sat_heating_value_max)})`,
                );
            }
          }
          return {
            ...e,
            entryQuality: entryQuality,
            overuseQuantity: overuseQuantity,
            overMaximumHourCapacityRight: overMaximumHourCapacityRight,
            bookValue: valueCapaArr,
            unit: e['row'][9],
            entryExitText: e['row'][10],
            zoneText: e['row'][0],
            areaText: e['row'][2],
            contractPointText: e['row'][3],
          };
        });
      }

      if (weekBook) {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: 'Nomination Point does not match the Contract Code.',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }
    // console.log('zoneQualityMaster : ', zoneQualityMaster);
    // console.log('sheet1Quality : ', sheet1Quality);

    // let overMaximumHourCapacityRight = null
    // console.log('warningLogHrTemp : ', warningLogHrTemp);
    const groupedBywarningLogHrTemp: any = Object.values(
      warningLogHrTemp.reduce((acc, item) => {
        const key = `${item?.hr}|${item?.contractPoint}|${item?.value}`;
        if (!acc[key]) {
          acc[key] = {
            hr: item.hr,
            contractPoint: item.contractPoint,
            value: item.value,
            valueDay: item.valueDay,
            data: [],
          };
        }
        acc[key].data.push(item);
        return acc;
      }, {}),
    );
    // console.log('groupedBywarningLogHrTemp : ', groupedBywarningLogHrTemp);
    for (let ig = 0; ig < groupedBywarningLogHrTemp.length; ig++) {
      const energyValues = groupedBywarningLogHrTemp[ig]?.data?.reduce(
        (accumulator, currentValue) => accumulator + currentValue?.energy || 0,
        0,
      );
      // overMaximumHourCapacityRight = true
      if (Number(energyValues) > Number(groupedBywarningLogHrTemp[ig]?.value)) {
        warningLogHr.push(
          `Nominated max energy ${energyValues} exceeds contracted value ${groupedBywarningLogHrTemp[ig]?.value || ''} for contract point ${groupedBywarningLogHrTemp[ig]?.contractPoint || '-'} and hour ${groupedBywarningLogHrTemp[ig]?.hr || '-'}`,
        );
      }
    }

    //  console.log('groupedBywarningLogHrTemp : ', groupedBywarningLogHrTemp);

    const groupedBywarningLogTotalTemp: any = Object.values(
      groupedBywarningLogHrTemp.reduce((acc, item) => {
        const key = `${item?.contractPoint}|${item?.value}`;
        if (!acc[key]) {
          acc[key] = {
            contractPoint: item.contractPoint,
            value: item.value,
            valueDay: item.valueDay,
            data: [],
          };
        }
        acc[key].data.push(item);
        return acc;
      }, {}),
    );
    // console.log('groupedBywarningLogTotalTemp : ', groupedBywarningLogTotalTemp);
    for (let ig = 0; ig < groupedBywarningLogTotalTemp.length; ig++) {
      const energyValues = groupedBywarningLogTotalTemp[ig]?.data?.reduce(
        (accumulator, currentValue) =>
          accumulator +
          currentValue?.data?.reduce(
            (accumulator, currentValue) =>
              accumulator + currentValue?.energy || 0,
            0,
          ) || 0,
        0,
      );
      // console.log('energyValues : ', energyValues);
      // contractPoint
      // value

      if (
        Number(energyValues) > Number(groupedBywarningLogTotalTemp[ig]?.value)
      ) {
        warningLogDay.push(
          `Nominated Total energy ${(energyValues && this.formatNumberThreeDecimal(energyValues)) || 0} exceeds contracted value ${Number(groupedBywarningLogTotalTemp[ig]?.valueDay)} for contract point ${groupedBywarningLogTotalTemp[ig]?.contractPoint} and gas day ${startDateEx}`,
        );
      }
    }

    // ----
    // https://app.clickup.com/t/86etrq2b6

    if (
      checkEmtry?.filter((f: any) => f === true).length === getsValue.length
    ) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'Nomination Point does not match Emtry All.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // return {
    //   checkEmtry: checkEmtry?.filter((f:any) => f === true),
    //   getsValue,
    //   cL: checkEmtry?.filter((f:any) => f === true).length,
    //   gL: getsValue.length,
    // }

    // sheet 2 check
    const indexSheetLastValue = sheet2.data.findIndex((row: any) =>
      row.includes('*'),
    );
    const fullShee2Data = [];
    for (let i = 0; i < sheet2?.data.length; i++) {
      if (i > 1 && i < indexSheetLastValue) {
        // console.log('--> : ', sheet2?.data?.[i]);
        fullShee2Data.push(sheet2?.data?.[i]);
        const zone = sheet2?.data?.[i]?.[0];
        const contractPoint = sheet2?.data?.[i]?.[1];
        // CO2 2=>(v2_carbon_dioxide_min, v2_carbon_dioxide_max) Carbon dioxide
        // C1 3=>(v2_methane_min, v2_methane_max) Methane
        // C2 4=>
        // C3 5=>
        // iC4 6=>
        // nC4 7=>
        // iC5 8=>
        // nC5 9=>
        // C6 10=>
        // C7 11=>
        // C2+ 12=>(v2_c2_plus_min, v2_c2_plus_max) C2+
        // N2 13=>(v2_nitrogen_min, v2_nitrogen_max) Nitrogen
        // O2 14=>(v2_oxygen_min, v2_oxygen_max) Oxgen
        // H2S 15=>(v2_hydrogen_sulfide_min, v2_hydrogen_sulfide_max) Hydrogen Sulfide
        // S 16=>(v2_total_sulphur_min, v2_total_sulphur_max) Total Sulphur
        // Hg 17=>(v2_mercury_min, v2_mercury_max) Mercury

        // check จาก contract code ด้วย ยังไม่ได้ทำ
        const ckContractPoint = await this.prisma.nomination_point.findFirst({
          where: {
            zone: {
              name: zone,
            },
            nomination_point: contractPoint,
          },
        });
        if (ckContractPoint) {
          // const findZone = zoneQualityMaster.find((f: any) => { return f?.name === sheet2?.data?.[i]?.[0] })
          // // CO2
          // if(Number(sheet2?.data?.[i]?.[2]) < Number(findZone?.zone_master_quality?.[0]?.v2_carbon_dioxide_min) || Number(sheet2?.data?.[i]?.[2]) > Number(findZone?.zone_master_quality?.[0]?.v2_carbon_dioxide_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[2])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_carbon_dioxide_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_carbon_dioxide_max)})`);
          // }
          // // C1
          // if(Number(sheet2?.data?.[i]?.[3]) < Number(findZone?.zone_master_quality?.[0]?.v2_methane_min) || Number(sheet2?.data?.[i]?.[3]) > Number(findZone?.zone_master_quality?.[0]?.v2_methane_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[3])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_methane_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_methane_max)})`);
          // }
          // // C2+
          // if(Number(sheet2?.data?.[i]?.[12]) < Number(findZone?.zone_master_quality?.[0]?.v2_c2_plus_min) || Number(sheet2?.data?.[i]?.[12]) > Number(findZone?.zone_master_quality?.[0]?.v2_c2_plus_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[12])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_c2_plus_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_c2_plus_max)})`);
          // }
          // // N2
          // if(Number(sheet2?.data?.[i]?.[13]) < Number(findZone?.zone_master_quality?.[0]?.v2_nitrogen_min) || Number(sheet2?.data?.[i]?.[13]) > Number(findZone?.zone_master_quality?.[0]?.v2_nitrogen_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[13])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_nitrogen_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_nitrogen_max)})`);
          // }
          // // O2
          // if(Number(sheet2?.data?.[i]?.[14]) < Number(findZone?.zone_master_quality?.[0]?.v2_oxygen_min) || Number(sheet2?.data?.[i]?.[14]) > Number(findZone?.zone_master_quality?.[0]?.v2_oxygen_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[14])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_oxygen_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_oxygen_max)})`);
          // }
          // // H2S
          // if(Number(sheet2?.data?.[i]?.[15]) < Number(findZone?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_min) || Number(sheet2?.data?.[i]?.[15]) > Number(findZone?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[15])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_max)})`);
          // }
          // // S
          // if(Number(sheet2?.data?.[i]?.[16]) < Number(findZone?.zone_master_quality?.[0]?.v2_total_sulphur_min) || Number(sheet2?.data?.[i]?.[16]) > Number(findZone?.zone_master_quality?.[0]?.v2_total_sulphur_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[16])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_total_sulphur_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_total_sulphur_max)})`);
          // }
          // // Hg
          // if(Number(sheet2?.data?.[i]?.[17]) < Number(findZone?.zone_master_quality?.[0]?.v2_mercury_min) || Number(sheet2?.data?.[i]?.[17]) > Number(findZone?.zone_master_quality?.[0]?.v2_mercury_max) ){
          //   sheet2Quality.push(`For nomination point ${sheet2?.data?.[i]?.[1]}, WI value (${Number(sheet2?.data?.[i]?.[17])}) is out of zone limits (${Number(findZone?.zone_master_quality?.[0]?.v2_mercury_min)} to ${Number(findZone?.zone_master_quality?.[0]?.v2_mercury_max)})`);
          // }
        }
      }
    }

    console.log('+++++++++ calc end +++++++++');

    const nominationFullJson = {
      shiperInfo: {
        '0': { 'SHIPPER ID': sheet1?.data?.[2]?.[0] },
        '1': { 'CONTRACT CODE': sheet1?.data?.[2]?.[1] },
        '2': { 'START DATE': sheet1?.data?.[2]?.[2] },
      },
      headData: this.transformColumnDF(sheet1?.data?.[3]),
      valueData: this.transformColumn(fullDataRow).map((e: any) => e?.row),
      typeDoc: {
        columnType: this.transformColumn(caseData?.columnType),
        columnParkUnparkinstructedFlows: this.transformColumn(
          caseData?.columnParkUnparkinstructedFlows,
        ),
        columnWHV: this.transformColumn(caseData?.columnWHV),
        columnPointId: this.transformColumn(caseData?.columnPointId),
        columnPointIdConcept: this.transformColumn(
          caseData?.columnPointIdConcept,
        ),
        columnOther: this.transformColumn(caseData?.columnOther),
      },
    };
    // 1 = columnPointId
    // 2 = columnPointIdConcept
    // 3 = columnType มี NONTPA
    // 4 = columnParkUnparkinstructedFlows
    // 5 = columnWHV

    // เพิ่มเงื่อนไข (ยังไม่ได้ทำ)
    // https://app.clickup.com/t/86et0vtn2
    // v2.0.16 Value Non TPA มากกว่า Nom ไม่มี Error แจ้งเตือน

    const nominationRowJson = [
      ...nominationFullJson?.typeDoc?.columnPointId.map((e: any) => {
        return {
          zone_text: e?.row?.['0'] || null,
          area_text: e?.row?.['2'] || null,
          entry_exit_id:
            e?.row?.['1'] === 'Supply' ? 1 : e?.row?.['1'] === 'Demand' ? 2 : null,
          data: e?.row,
          old_index: e?.ix,
          type: 1,
        };
      }),
      ...nominationFullJson?.typeDoc?.columnPointIdConcept.map((e: any) => {
        return {
          zone_text: e?.row?.['0'] || null,
          area_text: e?.row?.['2'] || null,
          entry_exit_id:
            e?.row?.['1'] === 'Supply' ? 1 : e?.row?.['1'] === 'Demand' ? 2 : null,
          data: e?.row,
          old_index: e?.ix,
          type: 2,
        };
      }),
      ...nominationFullJson?.typeDoc?.columnType.map((e: any) => {
        return {
          zone_text: e?.row?.['0'] || null,
          area_text: e?.row?.['2'] || null,
          entry_exit_id:
            e?.row?.['1'] === 'Supply' ? 1 : e?.row?.['1'] === 'Demand' ? 2 : null,
          data: e?.row,
          old_index: e?.ix,
          type: 3,
        };
      }),
      ...nominationFullJson?.typeDoc?.columnParkUnparkinstructedFlows.map(
        (e: any) => {
          return {
            zone_text: e?.row?.['0'] || null,
            area_text: e?.row?.['2'] || null,
            entry_exit_id:
              e?.row?.['1'] === 'Supply'
                ? 1
                : e?.row?.['1'] === 'Demand'
                  ? 2
                  : null,
            data: e?.row,
            old_index: e?.ix,
            type: 4,
          };
        },
      ),
      ...nominationFullJson?.typeDoc?.columnWHV.map((e: any) => {
        return {
          zone_text: e?.row?.['0'] || null,
          area_text: e?.row?.['2'] || null,
          entry_exit_id:
            e?.row?.['1'] === 'Supply' ? 1 : e?.row?.['1'] === 'Demand' ? 2 : null,
          data: e?.row,
          old_index: e?.ix,
          type: 5,
        };
      }),
      ...nominationFullJson?.typeDoc?.columnOther.map((e: any) => {
        return {
          zone_text: e?.row?.['0'] || null,
          area_text: e?.row?.['2'] || null,
          entry_exit_id:
            e?.row?.['1'] === 'Supply' ? 1 : e?.row?.['1'] === 'Demand' ? 2 : null,
          data: e?.row,
          old_index: e?.ix,
          type: 6,
        };
      }),
    ];

    const nominationFullJsonSheet2 = {
      headData: this.transformColumnDF(sheet2?.data?.[1]),
      valueData: fullShee2Data.map((e: any) => this.transformColumnDF(e)),
    };

    const responseUpFile = await uploadFilsTemp(fileOriginal);
    const nominationCount =
      await this.prisma.query_shipper_nomination_file.count({
        where: {
          nomination_type_id: nomination_type_id,
          create_date: {
            gte: getTodayStartAdd7().toDate(), // เริ่มต้นวันตามเวลาประเทศไทย
            lte: getTodayEndAdd7().toDate(), // สิ้นสุดวันตามเวลาประเทศไทย
          },
          // AND: [
          //   {
          //     OR: [
          //       { del_flag: false },
          //       { del_flag: null }
          //     ]
          //   }
          // ],
        },
      });

    const nomination_code = `${getTodayNow().format('YYYYMMDD')}-${nomination_type_id === 1 ? 'DNM' : 'WNM'}-${String(nominationCount + 1).padStart(4, '0')}`;

    const warningAll = [
      ...sheet1Quality,
      ...sheet2Quality,
      ...warningLogHr,
      ...warningLogDayWeek,
      ...warningLogDay,
    ];

    const finalData = {
      // sheet1,
      // sheet2,
      // sheet3,
      startDateExConv,
      nomination_code: nomination_code,
      dataInfo: {
        shipper_id,
        contract_code_id,
        checkType,
        nomination_type_id,
        files: responseUpFile?.file?.url,
        userId,
      },
      nominationFullJson,
      nominationRowJson,
      nominationFullJsonSheet2,
      renom,
      sheet1Quality: sheet1Quality,
      sheet2Quality: sheet2Quality,
      overuseQuantity:
        warningLogDayWeek.length || warningLogDay.length > 0 ? true : null,
      overMaximumHourCapacityRight:
        warningLogHr.length > 0 || warningLogDayWeek.length > 0 ? true : null,
      warningLogHr: warningLogHr,
      warningLogDay: warningLogDay,
      warningLogDayWeek: warningLogDayWeek,
      warningAll,
      informationData,
      // exampleBookingFullJson: bookingFullJson,
    };

    const newDate = getTodayNowAdd7();
    let checkVersion = null;
    checkVersion = await this.prisma.query_shipper_nomination_file.findFirst({
      where: {
        contract_code_id: Number(contract_code_id),
        nomination_type_id: Number(nomination_type_id),
        // query_shipper_nomination_status_id: 1,
        gas_day: getTodayNowDDMMYYYYDfaultAdd7(startDateEx).toDate(),
        // query_shipper_nomination_status: {
        //   id: { notIn: [2, 3, 4, 5] } // ✅ เงื่อนไขถูกต้อง
        // }
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
    });

    console.log('checkVersion : ', checkVersion);
    if (checkVersion?.query_shipper_nomination_status_id === 4) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'Nomination status Cancelled.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (nomination_type_id === 1) {
      console.log('nominationFullJson : ', nominationFullJson);
      console.log(
        'nominationFullJson?.typeDoc?.columnPointId : ',
        nominationFullJson?.typeDoc?.columnPointId,
      );
      const nominationData = nominationFullJson?.typeDoc?.columnPointId?.map(
        (e: any) => e?.row,
      );
      console.log('nominationData : ', nominationData);
      const nonTpaData = nominationFullJson?.typeDoc?.columnType?.map(
        (e: any) => e?.row,
      );
      for (let i = 0; i < nonTpaData.length; i++) {
        const nTpa = nonTpaData[i][3];
        const findNom = nonTpa?.find((f: any) => {
          return f?.non_tpa_point_name === nTpa;
        });
        const findNomName = findNom?.nomination_point?.nomination_point || null;
        const findNomData = nominationData?.find((f: any) => {
          return f[3] === findNomName && f[9] === 'MMBTU/D';
        });
        if (findNomData) {
          console.log('1--- nontpa : ', nonTpaData[i]?.[38]);
          console.log('1--- findNomData : ', findNomData?.[38]);
          if (
            !!nonTpaData[i]?.[38] &&
            !!findNomData?.[38] &&
            Number(nonTpaData[i]?.[38]) > Number(findNomData?.[38])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        } else {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    } else {
      // weekly
      const nominationData = nominationFullJson?.typeDoc?.columnPointId?.map(
        (e: any) => e?.row,
      );
      const nonTpaData = nominationFullJson?.typeDoc?.columnType?.map(
        (e: any) => e?.row,
      );
      for (let i = 0; i < nonTpaData.length; i++) {
        const nTpa = nonTpaData[i][3];
        const findNom = nonTpa?.find((f: any) => {
          return f?.non_tpa_point_name === nTpa;
        });
        const findNomName = findNom?.nomination_point?.nomination_point || null;
        const findNomData = nominationData?.find((f: any) => {
          return f[3] === findNomName;
        });
        if (findNomData) {
          if (
            !!nonTpaData[i]?.[14] &&
            !!findNomData?.[14] &&
            Number(nonTpaData[i]?.[14]) > Number(findNomData?.[14])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          if (
            !!nonTpaData[i]?.[15] &&
            !!findNomData?.[15] &&
            Number(nonTpaData[i]?.[15]) > Number(findNomData?.[15])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          if (
            !!nonTpaData[i]?.[16] &&
            !!findNomData?.[16] &&
            Number(nonTpaData[i]?.[16]) > Number(findNomData?.[16])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          if (
            !!nonTpaData[i]?.[17] &&
            !!findNomData?.[17] &&
            Number(nonTpaData[i]?.[17]) > Number(findNomData?.[17])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          if (
            !!nonTpaData[i]?.[18] &&
            !!findNomData?.[18] &&
            Number(nonTpaData[i]?.[18]) > Number(findNomData?.[18])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          if (
            !!nonTpaData[i]?.[19] &&
            !!findNomData?.[19] &&
            Number(nonTpaData[i]?.[19]) > Number(findNomData?.[19])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          if (
            !!nonTpaData[i]?.[20] &&
            !!findNomData?.[20] &&
            Number(nonTpaData[i]?.[20]) > Number(findNomData?.[20])
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        } else {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: `${findNomData[3]} must be greater than or equl ${nonTpaData[i][3]}`,
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    if (checkVersion) {
      console.log('------1');

      // มี update
      const contractStart = dayjs(contractCode?.contract_start_date).format(
        'YYYY-MM-DD',
      );
      const excelStart = dayjs(
        nominationFullJson?.shiperInfo?.['2']?.['START DATE'],
        'DD/MM/YYYY',
      ).format('YYYY-MM-DD');
      const isExcelStartBeforeContract = dayjs(excelStart).isBefore(
        dayjs(contractStart),
        'day',
      );
      if (isExcelStartBeforeContract) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error:
              'Failed Gas Day date does not match the Contract Start Date.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // update
      const queryShipperNominationFile =
        await this.prisma.query_shipper_nomination_file.update({
          where: {
            id: Number(checkVersion?.id),
          },
          data: {
            query_shipper_nomination_file_renom: {
              connect: {
                id: finalData?.renom ? 1 : 2,
              },
            },
            entry_quality: finalData?.sheet1Quality.length > 0 ? true : null,
            overuse_quantity: finalData?.overuseQuantity,
            over_maximum_hour_capacity_right:
              finalData?.overMaximumHourCapacityRight,
            gas_day: getTodayNowDDMMYYYYDfaultAdd7(startDateEx).toDate(),
            update_date_num: newDate.unix(),
            submitted_timestamp: newDate.toDate(),
            update_date: newDate.toDate(),
            update_by_account: {
              connect: {
                id: Number(userId),
              },
            },
            query_shipper_nomination_status: {
              connect: {
                id: 1,
              },
            },
          },
        });

      const flaseVersion = await this.prisma.nomination_version.updateMany({
        where: {
          query_shipper_nomination_file_id: Number(checkVersion?.id),
        },
        data: {
          flag_use: false,
        },
      });

      const nominationVersionCount = await this.prisma.nomination_version.count(
        {
          where: {
            query_shipper_nomination_file_id: queryShipperNominationFile?.id,
          },
        },
      );

      // version
      const nominationVersion = await this.prisma.nomination_version.create({
        data: {
          version: `V.${nominationVersionCount + 1}`,
          query_shipper_nomination_file: {
            connect: {
              id: queryShipperNominationFile?.id,
            },
          },
          flag_use: true,
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });

      // json full
      const fullJson = await this.prisma.nomination_full_json.create({
        data: {
          data_temp: JSON.stringify(nominationFullJson),
          nomination_version: {
            connect: {
              id: nominationVersion?.id,
            },
          },
          flag_use: true,
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });

      // json full sheet2
      const fullJson2 = await this.prisma.nomination_full_json_sheet2.create({
        data: {
          data_temp: JSON.stringify(nominationFullJsonSheet2),
          nomination_version: {
            connect: {
              id: nominationVersion?.id,
            },
          },
          flag_use: true,
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });

      // json row
      const rowJson = await this.prisma.nomination_row_json.createMany({
        data: (nominationRowJson || []).map((e: any) => {
          return {
            nomination_version_id: nominationVersion?.id,
            flag_use: true,
            zone_text: e?.zone_text,
            area_text: e?.area_text,
            entry_exit_id: e?.entry_exit_id,
            query_shipper_nomination_type_id: e?.type,
            data_temp: JSON.stringify(e?.data),
            old_index: e?.old_index,
            create_date_num: newDate.unix(),
            create_date: newDate.toDate(),
            create_by: Number(userId),
          };
        }),
      });

      // warning
      const submissionFile =
        await this.prisma.submission_comment_query_shipper_nomination_file.createMany(
          {
            data: (warningAll || []).map((e: any) => {
              return {
                remark: e,
                query_shipper_nomination_file_id: Number(
                  queryShipperNominationFile?.id,
                ),
                create_date_num: newDate.unix(),
                create_date: newDate.toDate(),
                create_by: Number(userId),
              };
            }),
          },
        );

      // file
      const queryShipperNominationFileUrl =
        await this.prisma.query_shipper_nomination_file_url.create({
          data: {
            url: finalData?.dataInfo?.files,
            query_shipper_nomination_file: {
              connect: {
                id: queryShipperNominationFile?.id,
              },
            },
            nomination_version: {
              connect: {
                id: nominationVersion?.id,
              },
            },
            query_shipper_nomination_status: {
              connect: {
                id: queryShipperNominationFile?.query_shipper_nomination_status_id,
              },
            },
            create_date_num: newDate.unix(),
            create_date: newDate.toDate(),
            create_by_account: {
              connect: {
                id: Number(userId),
              },
            },
          },
        });
      if (comment) {
        await this.queryShipperNominationFileService.comments(
          {
            reasons: false,
            comment: comment,
            query_shipper_nomination_file_id: Number(checkVersion?.id),
          },
          userId,
        );
      }
    } else {
      console.log('------2');
      // ไม่มี create
      const contractStart = dayjs(contractCode?.contract_start_date).format(
        'YYYY-MM-DD',
      );
      const excelStart = dayjs(
        nominationFullJson?.shiperInfo?.['2']?.['START DATE'],
        'DD/MM/YYYY',
      ).format('YYYY-MM-DD');
      const isExcelStartBeforeContract = dayjs(excelStart).isBefore(
        dayjs(contractStart),
        'day',
      );
      if (isExcelStartBeforeContract) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error:
              'Failed Gas Day date does not match the Contract Start Date.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      // query_shipper_nomination_file_renom
      // query_shipper_nomination_fileToquery_shipper_nomination_file_renom
      // create
      // nominated energy

      // console.log({
      //     entry_quality: finalData?.sheet1Quality.length > 0 ? true : null,
      //     overuse_quantity: finalData?.overuseQuantity,
      //     over_maximum_hour_capacity_right: finalData?.overMaximumHourCapacityRight,
      //     nomination_code: nomination_code,
      //     nomination_type: {
      //       connect: {
      //         id: Number(nomination_type_id),
      //       },
      //     },
      //     query_shipper_nomination_status: {
      //       connect: {
      //         id: 1,
      //       },
      //     },
      //     contract_code: {
      //       connect: {
      //         id: Number(contract_code_id),
      //       },
      //     },
      //     group: {
      //       connect: {
      //         id: Number(shipper_id),
      //       },
      //     },
      //     query_shipper_nomination_file_renom: {
      //       connect: {
      //         id: finalData?.renom ? 1 : 2,
      //       },
      //     },
      //     gas_day: startDateExConv.toDate(),
      //     create_date_num: newDate.unix(),
      //     submitted_timestamp: newDate.toDate(),
      //     create_date: newDate.toDate(),
      //     create_by_account: {
      //       connect: {
      //         id: Number(userId),
      //       },
      //     },
      //   });

      const queryShipperNominationFile =
        await this.prisma.query_shipper_nomination_file.create({
          data: {
            entry_quality: finalData?.sheet1Quality.length > 0 ? true : null,
            overuse_quantity: finalData?.overuseQuantity,
            over_maximum_hour_capacity_right:
              finalData?.overMaximumHourCapacityRight,
            nomination_code: nomination_code,
            nomination_type: {
              connect: {
                id: Number(nomination_type_id),
              },
            },
            query_shipper_nomination_status: {
              connect: {
                id: 1,
              },
            },
            contract_code: {
              connect: {
                id: Number(contract_code_id),
              },
            },
            group: {
              connect: {
                id: Number(shipper_id),
              },
            },
            query_shipper_nomination_file_renom: {
              connect: {
                id: finalData?.renom ? 1 : 2,
              },
            },
            gas_day: getTodayNowDDMMYYYYDfaultAdd7(startDateEx).toDate(),
            create_date_num: newDate.unix(),
            submitted_timestamp: newDate.toDate(),
            create_date: newDate.toDate(),
            create_by_account: {
              connect: {
                id: Number(userId),
              },
            },
          },
        });

      console.log('queryShipperNominationFile : ', queryShipperNominationFile);
      // version
      const nominationVersion = await this.prisma.nomination_version.create({
        data: {
          version: 'V.1',
          query_shipper_nomination_file: {
            connect: {
              id: queryShipperNominationFile?.id,
            },
          },
          flag_use: true,
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });

      // json full
      const fullJson = await this.prisma.nomination_full_json.create({
        data: {
          data_temp: JSON.stringify(nominationFullJson),
          nomination_version: {
            connect: {
              id: nominationVersion?.id,
            },
          },
          flag_use: true,
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });

      // json full sheet2
      const fullJson2 = await this.prisma.nomination_full_json_sheet2.create({
        data: {
          data_temp: JSON.stringify(nominationFullJsonSheet2),
          nomination_version: {
            connect: {
              id: nominationVersion?.id,
            },
          },
          flag_use: true,
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });

      // json row
      const rowJson = await this.prisma.nomination_row_json.createMany({
        data: (nominationRowJson || []).map((e: any) => {
          return {
            nomination_version_id: nominationVersion?.id,
            flag_use: true,
            zone_text: e?.zone_text,
            area_text: e?.area_text,
            entry_exit_id: e?.entry_exit_id,
            query_shipper_nomination_type_id: e?.type,
            data_temp: JSON.stringify(e?.data),
            old_index: e?.old_index,
            create_date_num: newDate.unix(),
            create_date: newDate.toDate(),
            create_by: Number(userId),
          };
        }),
      });

      // warning
      const submissionFile =
        await this.prisma.submission_comment_query_shipper_nomination_file.createMany(
          {
            data: (warningAll || []).map((e: any) => {
              return {
                remark: e,
                query_shipper_nomination_file_id: Number(
                  queryShipperNominationFile?.id,
                ),
                create_date_num: newDate.unix(),
                create_date: newDate.toDate(),
                create_by: Number(userId),
              };
            }),
          },
        );

      console.log('nominationVersion : ', nominationVersion);
      console.log('queryShipperNominationFile : ', queryShipperNominationFile);

      // file
      const queryShipperNominationFileUrl =
        await this.prisma.query_shipper_nomination_file_url.create({
          data: {
            url: finalData?.dataInfo?.files,
            query_shipper_nomination_file: {
              connect: {
                id: queryShipperNominationFile?.id,
              },
            },
            nomination_version: {
              connect: {
                id: nominationVersion?.id,
              },
            },
            query_shipper_nomination_status: {
              connect: {
                id: queryShipperNominationFile?.query_shipper_nomination_status_id,
              },
            },
            create_date_num: newDate.unix(),
            create_date: newDate.toDate(),
            create_by_account: {
              connect: {
                id: Number(userId),
              },
            },
          },
        });

      if (comment) {
        await this.queryShipperNominationFileService.comments(
          {
            reasons: false,
            comment: comment,
            query_shipper_nomination_file_id: queryShipperNominationFile?.id,
          },
          userId,
        );
      }
    }

    return finalData;
  }
}
