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
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import { getTodayEndAdd7, getTodayNow, getTodayNowAdd7, getTodayStartAdd7 } from 'src/common/utils/date.util';
import { Prisma } from '@prisma/client';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

@Injectable()
export class QueryShipperNominationFileService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) {}

  async findAll(userId?: any) {
    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        OR: [{ del_flag: false }, { del_flag: null }],
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: {
          include: {
            booking_version: {
              select: {
                booking_row_json: {
                  select: {
                    zone_text: true,
                    area_text: true,
                    entry_exit_id: true,
                    entry_exit: true,
                    contract_point: true,
                  },
                },
                booking_row_json_release: {
                  select: {
                    zone_text: true,
                    area_text: true,
                    entry_exit_id: true,
                    entry_exit: true,
                    contract_point: true,
                  },
                },
              },
              take: 1,
              where: {
                flag_use: true,
              },
              orderBy: {
                id: 'desc',
              },
            },
          },
        },
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

    const nominationPointList = await this.prisma.nomination_point.findMany({
      include: {
        contract_point_list: true,
      },
    })
    
    const todayNow = getTodayNow();
    const startOfToday = getTodayStartAdd7();
    // Initialize empty array for deadline list
    let deadlineList = [];
    try {
      // Get current date in UTC+7 timezone
      const todayStart = startOfToday.toDate();
      
      // Define base conditions for nomination deadline query
      const andInWhere : Prisma.new_nomination_deadlineWhereInput[] = [
        {
          start_date: {
            lte: todayStart, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
          },
        },
        {
          OR: [
            { end_date: null }, // ถ้า end_date เป็น null
            { end_date: { gt: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
          ],
        },
        {
          OR:[
            {
              process_type: {
                name: 'Management'
              }
            },
            {
              process_type: {
                id: 2
              }
            },
            {
              process_type: {
                name: 'Validity response of renomination'
              }
            },
            {
              process_type: {
                id: 4
              }
            }
          ]
        }
      ]
      // Get user's account management info including user type
      const accountManage = await this.prisma.account_manage.findFirst({
        where: {
          account_id: Number(userId),
        },
        include: {
          user_type: true,
        },
      });

      // Add user type filter if user is not admin (type 1)
      if(accountManage?.user_type_id && accountManage?.user_type_id != 1){
        andInWhere.push({
          user_type_id: accountManage?.user_type_id
        })
      }
  
      // Fetch nomination deadlines with process type info
      deadlineList = await this.prisma.new_nomination_deadline.findMany({
        where: {
          AND: andInWhere
        },
        include: {
          process_type: true,
        }
      })
    } catch (error) {
      // If any error occurs, set empty array as fallback
      deadlineList = []
    }
    
    const nresData = (resData && Array.isArray(resData)) ? resData.map(e => {
      const disabledFlag = e?.contract_code?.status_capacity_request_management_id === 3 || e?.contract_code?.status_capacity_request_management_id === 5 ? true : false

      const contractPointList = (e?.contract_code?.booking_version?.[0]?.booking_row_json && Array.isArray(e.contract_code.booking_version[0].booking_row_json)) ? e.contract_code.booking_version[0].booking_row_json.map(bookingRowJson => bookingRowJson?.contract_point) : []
      let endDate = e.gas_day
      if(e.nomination_type_id == 2){
        endDate = getTodayNowAdd7(e.gas_day).endOf('week').toDate()
      }
      const activeNominationPointList = (nominationPointList && Array.isArray(nominationPointList)) ? nominationPointList.filter(nominationPoint => {
        return nominationPoint?.start_date <= endDate &&
        (nominationPoint?.end_date === null || nominationPoint?.end_date >= e?.gas_day)
      }) : []

      // if(disabledFlag == false){
      //   // Find matching nomination deadline based on:
      //   // 1. Same nomination type
      //   // 2. Process type based on whether it's a renomination or not
      //   const deadlineListByType = deadlineList.filter(deadline => {
      //     return e.nomination_type_id == deadline.nomination_type_id && 
      //     (
      //       e.query_shipper_nomination_file_renom ?
      //         // For renomination: check process type 4 or 'Validity response of renomination'
      //         (deadline.process_type.id == 4 ||  deadline.process_type.name == 'Validity response of renomination')
      //         :
      //         // For normal nomination: check process type 2 or 'Management'
      //         (deadline.process_type.id == 2 ||  deadline.process_type.name == 'Management')
      //     )
      //   })
      //   // Find the object with minimum values using cascading comparison
      //   const nomDeadline = deadlineListByType.length < 1 ?
      //     undefined
      //   :
      //     deadlineListByType.reduce((min, current) => {
      //       if (current.before_gas_day < min.before_gas_day) {
      //         return current;
      //       } else if (current.before_gas_day === min.before_gas_day) {
      //         if (current.hour > min.hour) {
      //           return current;
      //         } else if (current.hour === min.hour) {
      //           if (current.minute > min.minute) {
      //             return current;
      //           }
      //         }
      //       }
      //       return min;
      //     }, deadlineListByType[0]);

      //   // Check if nomination deadline exists
      //   if(nomDeadline){
      //     // Parse the gas day into a dayjs object
      //     const gasDay = dayjs(e.gas_day)
      //     if(gasDay.isValid()){
      //       // Determine the time unit (week or day) based on whether it's a renomination
      //       const unit = 'day' //e.query_shipper_nomination_file_renom ? 'week' : 'day'
      //       // Calculate the deadline date by subtracting the specified time before gas day
      //       const deadlineDate = gasDay.subtract(nomDeadline.before_gas_day, unit)
      //       // Check if the deadline is before today's start - if so, disable the nomination
      //       if(deadlineDate.isBefore(startOfToday)){
      //         disabledFlag = true
      //       }
      //       // If deadline is today, check the specific time
      //       else if(deadlineDate.isSame(startOfToday)){
      //         // Disable if current hour is past the deadline hour
      //         if(todayNow.hour() > nomDeadline.hour){
      //           disabledFlag = true
      //         }
      //         // If same hour, check minutes
      //         else if(todayNow.hour() == nomDeadline.hour && todayNow.minute() > nomDeadline.minute){
      //           disabledFlag = true
      //         }
      //       }
      //     }
      //   }
      // }

      const nominationVersionWithContractPointList = e.nomination_version.map(nomination_version => {
        const nominationRowJsonWithContractPointList = nomination_version.nomination_row_json.map(nomination_row_json => {
          if(nomination_row_json.zone_text && nomination_row_json.area_text) { // is nom point
            const dataTemp = JSON.parse(nomination_row_json.data_temp)
            const targetContractPointList = activeNominationPointList
            .filter(nominationPoint => nominationPoint.nomination_point == dataTemp["3"])
            .map(nominationPoint => {
              const contractPointOfNomPointList = nominationPoint.contract_point_list.filter(contractPoint => contractPointList.includes(contractPoint.contract_point))

              return contractPointOfNomPointList
            })
            .flat() // Flatten the nested array to 1 level
            .filter((item, index, self) => 
              index === self.findIndex(obj => obj.id === item.id)
            ) // Remove duplicates by id
            
            return {...nomination_row_json, contract_point_list: targetContractPointList}
          }
          return nomination_row_json
        })

        nomination_version.nomination_row_json = nominationRowJsonWithContractPointList
        return nomination_version
      })

      e.nomination_version = nominationVersionWithContractPointList

      return {
        ...e,
        disabledFlag
      }
    }) : []

    return nresData;
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

  async status() {
    const resData = await this.prisma.query_shipper_nomination_status.findMany({
      orderBy: {
        id: 'asc',
      },
    });

    return resData;
  }

  async comments(payload: any, userId: any) {
    const { reasons, comment, query_shipper_nomination_file_id } = payload;
    const newDate = getTodayNowAdd7();
    const queryShipperNominationFile =
      await this.prisma.query_shipper_nomination_file.findFirst({
        where: {
          id: Number(query_shipper_nomination_file_id),
          AND: [
            {
              OR: [{ del_flag: false }, { del_flag: null }],
            },
          ],
        },
        include: {
          nomination_version: {
            where: {
              flag_use: true,
            },
            orderBy: {
              id: 'desc',
            },
          },
          query_shipper_nomination_file_url:{
            orderBy:{
              id: "desc"
            }
          },
        },
      });

    const versionId = queryShipperNominationFile?.nomination_version[0]?.id;
    const status =
      queryShipperNominationFile?.query_shipper_nomination_status_id;

    const userType = await this.prisma.user_type.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
    });
 
    const create =
      await this.prisma.query_shipper_nomination_file_comment.create({
        data: {
          remark: comment,
          query_shipper_nomination_file: {
            connect: {
              id: queryShipperNominationFile?.id,
            },
          },
          query_shipper_nomination_type_comment: {
            connect: {
              id: reasons
                ? 3
                : userType?.id === 3
                  ? 1
                  : userType?.id === 2
                    ? 2
                    : 2,
            },
          },
          query_shipper_nomination_status: {
            connect: {
              id: status,
            },
          },
          nomination_version: {
            connect: {
              id: versionId,
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

      
      await this.prisma.query_shipper_nomination_file_url.updateMany({
        where:{
          id: queryShipperNominationFile?.query_shipper_nomination_file_url[0]?.id
        },
        data:{
          query_shipper_nomination_status_id: Number(status)
        },
      })

    return create;
  }

  async editRowJSON(id: any, payload: any, userId: any) {
    const { rowChange } = payload;
    const newDate = getTodayNowAdd7();
    const idN = Number(id);
    const convertArrinObj = rowChange.map((e: any) => {
      return {
        ...e,
        data_temp: JSON.parse(e['data_temp']),
      };
    });

    const versionNom = await this.prisma.nomination_version.findFirst({
      where: {
        id: idN,
      },
      include: {
        nomination_full_json: true,
        nomination_full_json_sheet2: true,
        nomination_row_json: true,
      },
    });
    
    const fullJsonOld = await versionNom?.nomination_full_json.map((e: any) => ({
      ...e,
      data_temp: JSON.parse(e['data_temp']),
    }))[0];

    fullJsonOld.data_temp.valueData = fullJsonOld.data_temp.valueData?.map((e:any, ix:any) => {
      const findIx = rowChange?.find((f:any) => { return f?.old_index === ix })
      if(findIx){
        return JSON.parse(findIx?.data_temp)
      }else{
        return e
      }
    })

      Object.keys(fullJsonOld.data_temp.typeDoc || {}).forEach((key) => {
        // console.log('key : ', key);
        fullJsonOld.data_temp.typeDoc[key] = fullJsonOld.data_temp.typeDoc[key]?.map((tD:any) => {
          const findTD = rowChange?.find((f:any) => { return f?.old_index === tD?.ix })
          if(findTD){
            return { ...tD, row: JSON.parse(findTD?.data_temp) }
          }else{
            return tD
          }
        })
      });

    const rowJsonData = versionNom?.nomination_row_json?.map((e:any) => {
      const findIx = rowChange?.find((f:any) => { return f?.old_index === e?.old_index })
      if(findIx){
        return { ...e, data_temp: findIx?.data_temp }
      }else{
        return e
      }
    })

    const resultData = {
      row: rowJsonData,
      fullId: fullJsonOld?.id,
      full: fullJsonOld.data_temp,
    };

    // return resultData;

    const flaseVersion = await this.prisma.nomination_version.updateMany({
      where: {
        query_shipper_nomination_file_id: Number(
          versionNom?.query_shipper_nomination_file_id,
        ),
        
      },
      data: {
        flag_use: false,
      },
    });

    const nominationVersionCount = await this.prisma.nomination_version.count({
      where: {
        query_shipper_nomination_file_id:
          versionNom?.query_shipper_nomination_file_id,
      },
    });

    // version
    const nominationVersion = await this.prisma.nomination_version.create({
      data: {
        version: `V.${nominationVersionCount + 1}`,
        query_shipper_nomination_file: {
          connect: {
            id: versionNom?.query_shipper_nomination_file_id,
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

    const nom = await this.prisma.query_shipper_nomination_file.update({
      where:{
        id: versionNom?.query_shipper_nomination_file_id
      },
      data:{
        query_shipper_nomination_status_id: 1
      },
    })

    // row
    for (let i = 0; i < resultData?.row.length; i++) {
      await this.prisma.nomination_row_json.update({
        where: {
          id: Number(resultData?.row[i]?.id),
        },
        data: {
          data_temp: resultData?.row[i]['data_temp'],
        },
      });
    }

    // json full
    const fullJson = await this.prisma.nomination_full_json.create({
      data: {
        data_temp: JSON.stringify(resultData?.full),
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
        data_temp: versionNom?.nomination_full_json_sheet2[0]?.data_temp,
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
      data: (resultData?.row || []).map((e: any) => {
        const objDT = JSON.parse(e['data_temp']);
        const findRow = (versionNom?.nomination_row_json || []).find(
          (f: any) => {
            return f?.id === e?.id;
          },
        );
        return {
          nomination_version_id: nominationVersion?.id,
          flag_use: true,
          zone_text: objDT[0],
          area_text: objDT[2],
          entry_exit_id: findRow?.entry_exit_id,
          query_shipper_nomination_type_id:
            findRow?.query_shipper_nomination_type_id,
          data_temp: e['data_temp'],
          old_index: e?.old_index,
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by: Number(userId),
        };
      }),
    });

    return resultData;
  }

  async gKeyDataMMYYYY(gasDayMonth: any, data: any) {
    // ค้นหา key ที่มีเดือนและปีตรงกับ gasDayMonth
    const foundKey = Object.keys(data).find((dateStr) => {
      const monthYear = dayjs(dateStr, 'DD/MM/YYYY').format('MM YYYY'); // แปลงเป็นรูปแบบเดียวกัน
      return monthYear === gasDayMonth;
    });
    // ส่งค่ากลับเป็น key ถ้าพบ
    return foundKey ? data[foundKey].key : null;
  }

  async gKeyDataDDMMYYYY(gasDayMonth: any, data: any) {
    // ค้นหา key ที่มีเดือนและปีตรงกับ gasDayMonth
    const foundKey = Object.keys(data).find((dateStr) => {
      const daymonthYear = dayjs(dateStr, 'DD/MM/YYYY').format('DDMMYYYY'); // แปลงเป็นรูปแบบเดียวกัน
      return daymonthYear === gasDayMonth;
    });
    // ส่งค่ากลับเป็น key ถ้าพบ
    return foundKey ? data[foundKey].key : null;
  }

  transformData(data: any) {
    return data.reduce((acc, item) => {
      const key = Object.keys(item)[0]; // ดึง key เช่น "0", "1", "2"
      acc[key] = item[key]; // นำค่า object มาใส่ใน acc
      return acc;
    }, {});
  }

  async versionValidate(payload: any, userId: any) {
    const { nomination_type_id, contract_code_id, nomination_version_id } =
      payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const bookingVersion = await this.prisma.booking_version.findFirst({
      where: {
        contract_code_id: contract_code_id,
        flag_use: true,
      },
      include: {
        booking_row_json: true,
        booking_full_json: true,
        contract_code: {
          select: {
            term_type_id: true,
          }
        }
      },
    });

    const nominationVersion = await this.prisma.nomination_version.findFirst({
      where: {
        id: Number(nomination_version_id),
        query_shipper_nomination_file: {
          AND: [
            {
              OR: [{ del_flag: false }, { del_flag: null }],
            },
          ],
        },
      },
      include: {
        nomination_row_json: true,
        nomination_full_json: true,
        query_shipper_nomination_file: true,
      },
    });

    const gasDay = nominationVersion?.query_shipper_nomination_file?.gas_day;

    const areaMaster = await this.prisma.area.findMany({
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
        zone: {
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
      include: {
        zone: {
          include: {
            zone_master_quality: true,
          },
        },
      },
    });

    const nomList = await this.prisma.nomination_point.findMany({
      where: {},
      include: {
        contract_point_list: true,
      },
    });

    const bookingFull = JSON.parse(
      bookingVersion?.booking_full_json[0]?.data_temp,
    );
    const typeTerm = bookingFull?.shipperInfo['1']?.['Type of Contract'];
    const typeM = this.typeOfContractTextToNum(typeTerm) === 4 ? 2 : 1; // 1 month, 2 day
    const cMMBTUD =
      bookingFull?.headerEntry['Capacity Daily Booking (MMBTU/d)'];
    delete cMMBTUD['key'];
    const cMMSCFD = bookingFull?.headerEntry['Capacity Daily Booking (MMscfd)'];
    delete cMMSCFD['key'];
    const mMMBTUH = bookingFull?.headerEntry['Maximum Hour Booking (MMBTU/h)'];
    delete mMMBTUH['key'];
    const mMMSCFH = bookingFull?.headerEntry['Maximum Hour Booking (MMscfh)'];
    delete mMMSCFH['key'];
    const bookingRow = (bookingVersion?.booking_row_json && Array.isArray(bookingVersion.booking_row_json)) ? bookingVersion.booking_row_json.map((e: any) => {
      if (e && e['data_temp']) {
        e['data_temp'] = JSON.parse(e['data_temp']);
      }
      return { ...e };
    }) : [];

    const headData = (nominationVersion?.nomination_full_json?.[0]?.data_temp) ? JSON.parse(
      nominationVersion.nomination_full_json[0].data_temp,
    )?.headData : null;
    const objArr = headData ? Object.keys(headData) : [];

    const rowData = nominationVersion.nomination_row_json.map((e: any) => {
      const objTemp = JSON.parse(e['data_temp']);
      const objConvert = objArr.map((ob: any) => {
        return { [ob]: { header: headData[ob], value: objTemp[ob] } };
      });
      const newObj = this.transformData(objConvert);

      return { ...e, newObj };
    });

    // const gasDayMonth = "06 2025"
    const gasDayjs = dayjs(gasDay)
    const gasDayMonth = gasDayjs.format('MM YYYY');
    const gasDayMonthFull = dayjs(gasDay).format('DDMMYYYY');

    const nomRowData = await Promise.all(
      rowData.map(async (e: any) => {
        const zone = e['newObj'][0]?.value;
        const area = e['newObj'][2]?.value;
        const point = e['newObj'][3]?.value;
        const unit = e['newObj'][9]?.value;
        const entry_exit_id = e['newObj'][10]?.value === 'Entry' ? 1 : 2;
        // entry_exit_id
        const contractPointList =
          nomList.find((f: any) => {
            return (
              f?.nomination_point === point &&
              f?.entry_exit_id === entry_exit_id &&
              dayjs(f?.start_date).isSameOrBefore(gasDayjs, 'day') &&
              (f?.end_date ? dayjs(f?.end_date).isAfter(gasDayjs, 'day') : true)
            );
          })?.contract_point_list || []; // contract_point_list มีมากกว่า 1
        const rowBook =
          bookingRow.find((f: any) => {
            return (
              f?.contract_point ===
              contractPointList.find(
                (ff: any) => ff?.contract_point === f?.contract_point,
              )?.contract_point
            );
          }) || null;

        const findZoneMaster = areaMaster.find((f: any) => {
          return f?.name === area && f?.zone?.name === zone;
        });
        // WI
        e['newObj'][11].min =
          findZoneMaster?.zone?.zone_master_quality[0]?.v2_wobbe_index_min ||
          null;
        e['newObj'][11].max =
          findZoneMaster?.zone?.zone_master_quality[0]?.v2_wobbe_index_max ||
          null;
        // HV
        e['newObj'][12].min =
          findZoneMaster?.zone?.zone_master_quality[0]
            ?.v2_sat_heating_value_min || null;
        e['newObj'][12].max =
          findZoneMaster?.zone?.zone_master_quality[0]
            ?.v2_sat_heating_value_max || null;
        // SG ไม่มี

        let gKeyDataMMYYYYcMMBTUD = null;
        let gKeyDataMMYYYYmMMBTUH = null;
        let gKeyDataMMYYYYmMMSCFH = null;
        if(bookingVersion?.contract_code?.term_type_id === 4){ // short term non-firm
          gKeyDataMMYYYYcMMBTUD = await this.gKeyDataDDMMYYYY(
            gasDayMonthFull,
            cMMBTUD,
          );
          gKeyDataMMYYYYmMMBTUH = await this.gKeyDataDDMMYYYY(
            gasDayMonthFull,
            mMMBTUH,
          );
          gKeyDataMMYYYYmMMSCFH = await this.gKeyDataDDMMYYYY(
            gasDayMonthFull,
            mMMSCFH,
          );
        }
        else{
        gKeyDataMMYYYYcMMBTUD = await this.gKeyDataMMYYYY(
          gasDayMonth,
          cMMBTUD,
        );
        gKeyDataMMYYYYmMMBTUH = await this.gKeyDataMMYYYY(
          gasDayMonth,
          mMMBTUH,
        );
        gKeyDataMMYYYYmMMSCFH = await this.gKeyDataMMYYYY(
          gasDayMonth,
          mMMSCFH,
        );
        }

        // nomination_type_id // 1 day, 2 week

        if (e['query_shipper_nomination_type_id'] === 1) {
          // เอาออกทีหลัง
          // columnPointId
          // MMSCFD
          // MMBTU/D
          // entry_exit_id
          if (e['entry_exit_id'] === 1) {
            if (nomination_type_id === 1) {
              // day
              if (unit === 'MMBTU/D') {
                const valueBook =
                  (!!gKeyDataMMYYYYmMMBTUH &&
                    rowBook?.data_temp[gKeyDataMMYYYYmMMBTUH]) ||
                  null;
                const valueBookDay =
                  (!!gKeyDataMMYYYYcMMBTUD &&
                    rowBook?.data_temp[gKeyDataMMYYYYcMMBTUD]) ||
                  null;
                for (let iNo = 14; iNo < 38; iNo++) {
                  e['newObj'][iNo].valueBook = valueBook;
                  e['newObj'][iNo].valueBookDay = valueBookDay;
                }
              } else if (unit === 'MMSCFD') {
                const valueBook =
                  (!!gKeyDataMMYYYYmMMSCFH &&
                    rowBook?.data_temp[gKeyDataMMYYYYmMMSCFH]) ||
                  null;
                const valueBookDay =
                  (!!gKeyDataMMYYYYcMMBTUD &&
                    rowBook?.data_temp[gKeyDataMMYYYYcMMBTUD]) ||
                  null;
                for (let iNo = 14; iNo < 38; iNo++) {
                  e['newObj'][iNo].valueBook = valueBook;
                  e['newObj'][iNo].valueBookDay = valueBookDay;
                }
              }
            } else {
              // week
              // if(unit === "MMBTU/D"){
              const valueBook =
                (!!gKeyDataMMYYYYcMMBTUD &&
                  rowBook?.data_temp[gKeyDataMMYYYYcMMBTUD]) ||
                null;
              // console.log('valueBook : ', valueBook);
              for (let iNo = 14; iNo < 21; iNo++) {
                e['newObj'][iNo].valueBook = valueBook;
              }
              // }else if(unit === "MMSCFD"){
              //   const valueBook = !!gKeyDataMMYYYYcMMBTUD && rowBook?.data_temp[gKeyDataMMYYYYcMMBTUD] || null
              //   for (let iNo = 14; iNo < 38; iNo++) {
              //     e["newObj"][iNo].valueBook = valueBook
              //   }
              // }
            }
          } else {
            if (nomination_type_id === 1) {
              // day
              if (unit === 'MMBTU/D') {
                const valueBook =
                  (!!gKeyDataMMYYYYmMMBTUH &&
                    rowBook?.data_temp[gKeyDataMMYYYYmMMBTUH]) ||
                  null;
                const valueBookDay =
                  (!!gKeyDataMMYYYYcMMBTUD &&
                    rowBook?.data_temp[gKeyDataMMYYYYcMMBTUD]) ||
                  null;
                for (let iNo = 14; iNo < 38; iNo++) {
                  e['newObj'][iNo].valueBook = valueBook;
                  e['newObj'][iNo].valueBookDay = valueBookDay;
                }
              }
            } else {
              // week
              if (unit === 'MMBTU/D') {
                const valueBook =
                  (!!gKeyDataMMYYYYcMMBTUD &&
                    rowBook?.data_temp[gKeyDataMMYYYYcMMBTUD]) ||
                  null;
                for (let iNo = 14; iNo < 21; iNo++) {
                  e['newObj'][iNo].valueBook = valueBook;
                }
              }
            }
          }
        } else if (e['query_shipper_nomination_type_id'] === 2) {
          // เอาออกทีหลัง
          // columnPointIdConcept
          // MMSCFD
          // MMBTU/D
        } else if (e['query_shipper_nomination_type_id'] === 3) {
          // เอาออกทีหลัง
          // columnType
          // MMSCFD
          // MMBTU/D
        } else if (e['query_shipper_nomination_type_id'] === 4) {
          // เอาออกทีหลัง
          // columnParkUnparkinstructedFlows
          // MMSCFD
          // MMBTU/D
        } else if (e['query_shipper_nomination_type_id'] === 5) {
          // เอาออกทีหลัง
          // columnWHV
          // MMSCFD
          // MMBTU/D
        }

        return { ...e };
      }),
    );

    return nomRowData;
  }

  async autoGen(id: any, payload: any, userId: any) {}
  
  async updateStatus(payload: any, userId: any) {
    const { id, status, comment } = payload;
    const nowAt = getTodayNowAdd7()

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const nominationDeadlineManage = await this.prisma.new_nomination_deadline.findMany({
      where: {
        // before_gas_day
        
        process_type_id:2,
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
    })

    console.log('nominationDeadlineManage : ', nominationDeadlineManage);

    const dwManage = await this.prisma.query_shipper_nomination_file?.findMany({
      where:{

      },include:{

      },
    })


    for (let i = 0; i < id.length; i++) {
      const findId = dwManage?.find((f:any) => { return f?.id === Number(id[i]) })
      const deadlineManage = nominationDeadlineManage?.find((f:any) => { return f?.nomination_type_id === findId?.nomination_type_id })
      // const before_gas_day = deadlineManage?.before_gas_day && Number(deadlineManage?.before_gas_day) || 0
      // if(before_gas_day > 0){
      //   const target = dayjs(findId?.gas_day); // เป้าหมาย
      //   const isOneDayBefore = nowAt.isSame(target.subtract(before_gas_day, 'day'), 'day');
      //   console.log('before_gas_day : ', before_gas_day);
      //   console.log('nowAt : ', nowAt);
      //   console.log('target : ', target);
      //   console.log('isOneDayBefore : ', isOneDayBefore);
      //   if(!!isOneDayBefore){
      //     throw new HttpException(
      //       {
      //         status: HttpStatus.BAD_REQUEST,
      //         error: 'Gas Day Missing required fields Nomination Deadline',
      //       },
      //       HttpStatus.BAD_REQUEST,
      //     );
      //   }       
      // }

      const queryNom = await this.prisma.query_shipper_nomination_file.update({
        where: {
          id: Number(id[i]),
        },
        data: {
          query_shipper_nomination_status_id: Number(status),
        },
      });

      this.comments(
        {
          reasons: true, // ใส่ false ตลอด
          comment: comment,
          query_shipper_nomination_file_id: id[i],
        },
        userId,
      );
    }

    return `Success.`;
  }
 
  // 
  async shipperNominationReport(query?: {
    gasDay?: string;
  }) {
    const targetDate = getTodayStartAdd7(query?.gasDay)
    const todayStart = getTodayStartAdd7(query?.gasDay).toDate();
    const todayEnd = getTodayEndAdd7(query?.gasDay).toDate();
    // Calculate previous Sunday for weekly nominations
    const previousSunday = targetDate.subtract(targetDate.day(), 'day').startOf('day');
    const nextSunday = previousSunday.add(1, 'day');
    
    const daysOfWeek = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];

    const contractCodeMasterDB = await this.prisma.contract_code.findMany({
      where: {
        OR: [
          {
            status_capacity_request_management: {
             id: {
               in: [2],
             },
           },
          },
          {
            AND: [
              {
                status_capacity_request_management: {
                 id: {
                   in: [5],
                 },
               },
              },
              {
                contract_start_date: {
                  lte: todayStart,
                },
              },
              {
                terminate_date: {
                  gt: todayStart,
                }
              }
            ]
          }
        ]
      },
      include: {
        booking_version: {
          include: {
            booking_full_json: true,
            booking_row_json: true,
            booking_full_json_release: true,
            booking_row_json_release: true,
          },
          take: 1,
          where:{
            flag_use:true,
          },
          orderBy: {
            id: 'desc',
          },
        },
      },
    });

    const areaMaster = await this.prisma.area.findMany({
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
      select:{
        id:true,
        name:true,
        area_nominal_capacity:true,
        color:true,
        entry_exit_id:true,
        zone_id:true,
      },
    });

    const zoneMaster = await this.prisma.zone.findMany({
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
      select:{
        id:true,
        name:true,
        color:true,
        entry_exit_id:true,
      },
    });

    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        // id: 116,

        AND: [
          {
        OR: [{ del_flag: false }, { del_flag: null }],
          },
          {
        query_shipper_nomination_status: {
          id:{
            in:[2, 5]
          }
        },
          },
          {
            OR: [
              // For weekly nominations (type_id = 2), check both current and previous Sunday
              {
                AND: [
                  { nomination_type_id: 2 },
                  {
                    gas_day: {
                      gte: previousSunday.toDate(),
                      lt: nextSunday.toDate(),
                    }
                  }
                ]
              },
              // For daily nominations (type_id = 1), check the requested date
              {
                AND: [
                  { nomination_type_id: 1 },
                  {
                    gas_day: {
                      gte: todayStart,
                      lte: todayEnd,
                    }
                  }
                ]
              }
            ]
          },
          {
            OR: [
              {
                contract_code: {
                  status_capacity_request_management_id: 2
                }
              },
              {
                contract_code: {
                  status_capacity_request_management_id: 5,
                  contract_start_date: {
                    lte: todayStart,
                  },
                  terminate_date: {
                    gt: todayStart,
                  }
                }
              }
            ]
          }
        ]
        // id: 47,
        // nomination_type_id: 2,
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: true,
        // submission_comment_query_shipper_nomination_file: true,
        nomination_type: true,
        nomination_version: {
          include: {
            nomination_full_json: true,
            // nomination_full_json_sheet2: true,
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
        // query_shipper_nomination_file_renom: true,
        // query_shipper_nomination_file_url: {
        //   include: {
        //     nomination_version: true,
        //     query_shipper_nomination_status: true,
        //     create_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //     update_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //   },
        //   orderBy: {
        //     id: 'desc',
        //   },
        // },
        // query_shipper_nomination_file_comment: {
        //   include: {
        //     query_shipper_nomination_type_comment: true,
        //     query_shipper_nomination_status: true,
        //     nomination_version: true,
        //     create_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //     update_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //   },
        //   orderBy: {
        //     id: 'desc',
        //   },
        // },
      },
      orderBy: {
        id: 'desc',
      },
    });
    console.log('contractCodeMasterDB : ', contractCodeMasterDB);
    const contractCodeMaster = (contractCodeMasterDB && Array.isArray(contractCodeMasterDB)) ? contractCodeMasterDB.map((e:any) => {
      const { booking_version, ...nE } = e
      const d_booking_version = booking_version?.map((eBv:any) => {
        const { booking_full_json, booking_row_json, ...neBv } = eBv
        const d_booking_full_json = booking_full_json?.map((eFj:any) => {
          const { data_temp, ...neFj } = eFj
          return { ...neFj, data_temp: JSON.parse(data_temp) }
        })
        const d_booking_row_json = booking_row_json?.map((eFj:any) => {
          const { data_temp, ...neFj } = eFj
          return { ...neFj, data_temp: JSON.parse(data_temp) }
        })

        return { ...neBv, booking_full_json:d_booking_full_json, booking_row_json:d_booking_row_json }
      })

      return { ...nE, booking_version: d_booking_version }
    }) : []

    const grouped = {};
    for (const curr of resData) {
      const key = `${curr.gas_day}|${curr.group?.name}|${curr?.nomination_type?.id}`;

      if (!grouped[key]) {
        grouped[key] = {
          gas_day: curr.gas_day,
          shipper_name: curr.group?.name,
          nomination_type: curr?.nomination_type,
          data: [],
        };
      }

      grouped[key].data.push({ ...curr });
    }
    const resultGroup: any = Object.values(grouped);

    const resultGroupType = resultGroup.map((e: any) => {
      e['data'] = e['data']?.map((eData: any) => {
        eData['nomination_version'] = eData['nomination_version']?.map(
          (eDataNom: any) => {
            eDataNom['nomination_full_json'] = eDataNom[
              'nomination_full_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = JSON.parse(eDataNomJson['data_temp']);
              return { ...eDataNomJson };
            });
            // eDataNom["nomination_full_json_sheet2"] = eDataNom["nomination_full_json_sheet2"]?.map((eDataNomJson:any) => {
            //   eDataNomJson["data_temp"] = JSON.parse(eDataNomJson["data_temp"])
            //   return { ...eDataNomJson }
            // })
            eDataNom['nomination_row_json'] = eDataNom[
              'nomination_row_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = JSON.parse(eDataNomJson['data_temp']);
              return { ...eDataNomJson };
            });
            return { ...eDataNom };
          },
        );
        return { ...eData };
      });

      const gas_day_text = dayjs(e['gas_day']).format('DD/MM/YYYY');
      const shipper_name = e['shipper_name'];
      
      return {
        shipper_name,
        gas_day: gas_day_text,
        gas_day_text,
        dataDW: e['data'],
        nomination_type: e['nomination_type'],
      };
    });

    console.log('***');

    console.time('resultGroupKeyAddArea');
    // nom
    const resultGroupKeyAddArea = resultGroupType.map((e: any, ix:number) => {
      const { dataDW, ...eData } = e;
      const nomination_type_id = eData?.nomination_type?.id
      // console.time('dwData');
      const dwData = dataDW.flatMap((fM: any) => {
        const { nomination_version, ...dFm } = fM;
        const d_nomination_version = nomination_version.flatMap(
          (fnomination_version: any) => {
            const {
              nomination_row_json,
              nomination_full_json,
              ...dfnomination_version
            } = fnomination_version;

            const row = nomination_row_json?.filter((f:any) => f?.query_shipper_nomination_type_id === 1).map((mFM: any) => {
              return {
                gas_day: e["gas_day"],
                nom: { ...dFm },
                contract_code_id: dFm?.contract_code_id,
                version: { ...dfnomination_version },
                headData: nomination_full_json[0]?.data_temp?.headData,
                entry_exit_text: mFM['data_temp']['10'],
                ...mFM,
              };
            });

            const rowFilType = row?.filter((f: any) => {
              return (
                f?.query_shipper_nomination_type_id === 1 ||
                f?.query_shipper_nomination_type_id === 2
              );
            });
            
            const rowFilType1MMBTUandMMSCFD = rowFilType
            
            return [...rowFilType1MMBTUandMMSCFD];
          },
        );

        return [...d_nomination_version];
      });
      // console.timeEnd('dwData');

      // console.time('dwDataConcept');
      const dwDataConcept = dataDW.flatMap((fM: any) => {
        const { nomination_version, ...dFm } = fM;
        const d_nomination_version = nomination_version.flatMap(
          (fnomination_version: any) => {
            const {
              nomination_row_json,
              nomination_full_json,
              ...dfnomination_version
            } = fnomination_version;
            const row = nomination_row_json.filter((f:any) => f?.query_shipper_nomination_type_id != 1).map((mFM: any) => {
              return {
                nom: { ...dFm },
                contract_code_id: dFm?.contract_code_id,
                version: { ...dfnomination_version },
                headData: nomination_full_json[0]?.data_temp?.headData,
                entry_exit_text: mFM['data_temp']['10'],
                ...mFM,
              };
            });

            const rowFilType = row?.filter((f: any) => {
              return (
                f?.query_shipper_nomination_type_id !=1
              );
            });
           
            const rowFilType1All = rowFilType

            return [...rowFilType1All];
          },
        );

        return [...d_nomination_version];
      });
      // console.timeEnd('dwDataConcept');

      
      const groupedDatas = {};
      for (const curr of dwData) {
        // dwDataConcept
        const key = `${curr.area_text}|${curr.zone_text}`;

        if (!groupedDatas[key]) {
          groupedDatas[key] = {
            gas_day: curr.gas_day,
            area_text: curr.area_text,
            zone_text: curr.zone_text,
            data: [],
            contract_code_id_arr: [],
          };
        }

        groupedDatas[key].data.push({ ...curr });
        groupedDatas[key].contract_code_id_arr = Array.from(new Set([
          ...groupedDatas[key].contract_code_id_arr,
          curr?.contract_code_id
        ]));
      }
      const resultGroupArea: any = Object.values(groupedDatas);
      console.log('resultGroupArea : ', resultGroupArea);
      console.log('contractCodeMaster : ', contractCodeMaster);
       const booking_version = resultGroupArea?.flatMap((cd:any) => {
        // contract_code_id_arr
         const contractCodeDataId = cd?.contract_code_id_arr?.map((cta:any) => {
          const findCt = contractCodeMaster?.find((f:any) => { return f?.id === cta })
          return findCt
        })
        console.log('contractCodeDataId : ', contractCodeDataId);
        const contractCodeDataIdFM = contractCodeDataId?.flatMap((cdFM:any) => {
          const bjr = cdFM?.["booking_version"][0]?.["booking_row_json"]?.map((cdj:any) => ({
            ...cdj, 
            area_text: cdj?.area_text,
            contract_code_id_arr: [cdFM?.id],
            data:[],
            gas_day: cd?.gas_day,
            zone_text: cdj?.zone_text,
          }))
          return [
          ...bjr
        ]

        })
        return [
          ...contractCodeDataIdFM
        ]
      })
      const resultGroupAreaMatch = [...resultGroupArea]
      for (let iB = 0; iB < booking_version.length; iB++) {
        const findS = resultGroupAreaMatch?.find((f:any) => { return f?.area_text === booking_version[iB]?.area_text && f?.zone_text === booking_version[iB]?.zone_text })
        if(!findS){
          resultGroupAreaMatch.push({ ...booking_version[iB] })
        }
      }
      
      const resultGroupAreaExt = resultGroupAreaMatch?.map((rEx: any) => {
        const { data, ...nrEx } = rEx;

        const azData = data?.map((az:any) => {
          const zoneObj = zoneMaster.find((f:any) => { return f?.name === az?.zone_text })
          const areaObj = areaMaster.find((f:any) => { return f?.name === az?.area_text })

          return { zoneObj, areaObj, ...az }
        })
        const nominaionPoint = azData?.filter((f: any) => {
          return f?.query_shipper_nomination_type_id === 1;
        });
        const nomGroupedZone = {};
        for (const curr of nominaionPoint) {
          const key = `${curr.zone_text}`;

          if (!nomGroupedZone[key]) {
            nomGroupedZone[key] = {
              zone_text: curr.zone_text,
              zone: [],
            };
          }

          nomGroupedZone[key].zone.push({ ...curr });
        }
        const nominaionPointZone: any = Object.values(nomGroupedZone);
        const dwDataConceptZone = dwDataConcept?.filter((f: any) => {
          return f?.zone_text === rEx?.zone_text;
        });
       
        const conceptPoint = dwDataConceptZone
        const conceptGroupedZone = {};
        for (const curr of conceptPoint) {
          const key = `${curr.zone_text}`;

          if (!conceptGroupedZone[key]) {
            conceptGroupedZone[key] = {
              zone_text: curr.zone_text,
              zone: [],
            };
          }

          conceptGroupedZone[key].zone.push({ ...curr });
        }
        const conceptPointZone: any = Object.values(conceptGroupedZone);
        const contractCodeData = nrEx?.contract_code_id_arr?.map((cta:any) => {
          const findCt = contractCodeMaster?.find((f:any) => { return f?.id === cta })
          return findCt
        })
        
        const capacityRightMMBTUDOnce = (area:any, date:any) => {
          const matchVersionCode = contractCodeData?.flatMap((ccd:any) => {
          
            const ccdVersion = ccd?.booking_version?.map((ccdV:any) => {
              const dateOne = ccd?.term_type_id === 4 ? dayjs(date, "DD/MM/YYYY").format("DD/MM/YYYY") : dayjs(date, "DD/MM/YYYY").format("01/MM/YYYY")

              const keyDate = ccdV?.booking_full_json[0]?.data_temp?.headerExit["Capacity Daily Booking (MMBTU/d)"][dateOne]?.key || null
              const fArea = ccdV?.booking_row_json?.filter((f:any) => { return f?.area_text === area })
              
              let calcContract = 0
              if(keyDate){
                calcContract = fArea?.reduce(
                  (accumulator, currentValue) => {
                    return accumulator + Number(currentValue?.["data_temp"]?.[keyDate]?.trim()?.replace(/,/g, '') || 0)
                  },
                  0,
                );
                
              }
              
              return calcContract
            })

            return [
              ...ccdVersion,
            ]
          }).reduce(
            (accumulator, currentValue) => accumulator + currentValue,
            0,
          );

          return matchVersionCode
        }; 

        const nomCalc = (nom:any, nomType:any) => {

          if(nomType === 1){
            // daily
            let calcData = 0
            for (let iCal = 0; iCal < nom.length; iCal++) {
              for (let iCalZone = 0; iCalZone < nom[iCal]?.zone.length; iCalZone++) {
                // MMSCFD
                // MMBTU/D
                // data_temp
                if(nom[iCal]?.zone[iCalZone]?.data_temp["9"] === "MMBTU/D"){
                  const valueDT = Number(nom[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                  calcData = calcData + valueDT
                }
              }
            }
            return calcData;
          }else{
            // weekly ทำที่ weeklyDay
            return 0;
          }
        }

        const capacityRightMMBTUD = nomination_type_id === 1 && capacityRightMMBTUDOnce(nrEx?.area_text, nrEx?.gas_day);
        const nominatedValueMMBTUD = nomination_type_id === 1 && nomCalc(nominaionPointZone, nomination_type_id);
        const overusageMMBTUD = nomination_type_id === 1 && nomCalc(nominaionPointZone, nomination_type_id) - capacityRightMMBTUDOnce(nrEx?.area_text, nrEx?.gas_day) > 0 ? (nomCalc(nominaionPointZone, nomination_type_id) - capacityRightMMBTUDOnce(nrEx?.area_text, nrEx?.gas_day)) : 0;

        const zoneObj = zoneMaster.find((f:any) => { return f?.name === nrEx?.zone_text })
        const areaObj = areaMaster.find((f:any) => { return f?.name === nrEx?.area_text })
       

        const startDate = dayjs(eData?.gas_day_text, "DD/MM/YYYY");
        const weeklyDay: any = {};
  
        daysOfWeek.forEach((day, index) => {
          
          const nomCalcWeek = (gasDay:any, nom:any, nomType:any) => {
            if(nomType === 2){
              let calcData = 0
              for (let iCal = 0; iCal < nom.length; iCal++) {
                for (let iCalZone = 0; iCalZone < nom[iCal]?.zone.length; iCalZone++) {
                
                  const foundEntry = Object.entries(nom[iCal]?.zone[iCalZone]?.headData || {}).find(([key, value]) => { 
                    return value?.toString().trim() === gasDay.toString().trim()
                   });
                  const headDataDTKey = foundEntry ? foundEntry[0] : undefined;
                  if(nom[iCal]?.zone[iCalZone]?.data_temp["9"] === "MMBTU/D"){
                    const valueDT = headDataDTKey ? Number(nom[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) : 0
                    calcData = calcData + valueDT
                  }
                }
              }
             
              return calcData;
            }
          }
          const capacityRightMMBTUDWeek = capacityRightMMBTUDOnce(nrEx?.area_text ,startDate.add(index, 'day').format("DD/MM/YYYY"))
          const nominatedValueMMBTUDWeek = nomCalcWeek(startDate.add(index, 'day').format("DD/MM/YYYY"), nominaionPointZone, nomination_type_id)
          const overusageMMBTUDWeek = nominatedValueMMBTUDWeek - capacityRightMMBTUDWeek > 0 ? (nominatedValueMMBTUDWeek - capacityRightMMBTUDWeek) : 0
          weeklyDay[day] = {
            gas_day_text: startDate.add(index, 'day').format("DD/MM/YYYY"),
            capacityRightMMBTUD: capacityRightMMBTUDWeek,
            nominatedValueMMBTUD: nominatedValueMMBTUDWeek,
            overusageMMBTUD: overusageMMBTUDWeek,
          };
        });
       
        const overusageMMBTUDDaily = overusageMMBTUD
        return {
          gas_day: eData?.gas_day_text,
          shipper_name: eData?.shipper_name,
          ...nrEx,
          zoneObj,
          areaObj,
          nominaionPointZone,
          conceptPointZone,
          capacityRightMMBTUD,
          nominatedValueMMBTUD,
          overusageMMBTUD: overusageMMBTUDDaily,
          weeklyDay,
        };
      });

       // หา contract
       const contractAll = [...new Set(resultGroupAreaExt?.map((rg:any) => rg?.contract_code_id_arr).flat())]
       const contractCodeData = contractAll?.map((cta:any) => {
         const findCt = contractCodeMaster?.find((f:any) => { return f?.id === cta })
         return findCt
       })
       
       const capacityRightMMBTUD = (date:any, noms:any) => {
        const areaBJR = noms?.map((brj:any) => brj?.area_text)
        const matchVersionCode = contractCodeData?.flatMap((ccd:any) => {
          const ccdVersion = ccd?.booking_version?.map((ccdV:any) => {
            // DD/MM/YYYY
            const dateOne = ccd?.term_type_id === 4 ? dayjs(date, "DD/MM/YYYY").format("DD/MM/YYYY") : dayjs(date, "DD/MM/YYYY").format("01/MM/YYYY")
            const keyDate = ccdV?.booking_full_json[0]?.data_temp?.headerExit["Capacity Daily Booking (MMBTU/d)"][dateOne]?.key || null
            // entry_exit_id
            // const brjExit = ccdV?.booking_row_json?.filter((f:any) => f?.entry_exit_id === 2)
            const brjExit = ccdV?.booking_row_json?.filter((f:any) => areaBJR.includes(f?.area_text))
            let calcContract = 0
            if(keyDate){
              calcContract = brjExit.reduce(
                (accumulator, currentValue) => accumulator + Number(currentValue?.["data_temp"]?.[keyDate]?.replace(/,/g, '') || 0),
                0,
              );
              
            }
            return calcContract
          })
         
          return [
            ...ccdVersion,
          ]
        }).reduce(
          (accumulator, currentValue) => accumulator + currentValue,
          0,
        );

        return matchVersionCode
      };

      const nomCalc = (noms:any, nomType:any) => {
          // nominaionPointZone
          const nom = [...noms.map((eNo:any) => eNo?.nominaionPointZone)].flat()
        if(nomType === 1){
          // daily
          let calcData = 0
          for (let iCal = 0; iCal < nom.length; iCal++) {
            for (let iCalZone = 0; iCalZone < nom[iCal]?.zone.length; iCalZone++) {
              if(nom[iCal]?.zone[iCalZone]?.data_temp["9"] === "MMBTU/D"){
                const valueDT = Number(nom[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                calcData = calcData + valueDT
              }
            }
          }
          return calcData;
        }else{
          // weekly ทำที่ weeklyDay
          return 0;
        }
      }
      const imbalanceMMBTUDCalc = (noms:any, nomType:any) => {
        const nom = [...noms.map((eNo:any) => eNo?.nominaionPointZone)].flat()
        const concept = [...noms.map((eNo:any) => eNo?.conceptPointZone)].flat()
        // nom?.nomination_type_id
        // Park
        // Unpark
        // Min_Inventory_Change
        // Shrinkage_Volume
        // entry - exit - Min_Inventory_Change - Park + Unpark - Shrinkage_Volume
        if(nomType === 1){
          // daily
          let calcData = 0
          let nomEntry = 0
          let nomExit = 0
          let Park = 0
          let Unpark = 0
          let MinInventoryChange = 0
          let ShrinkageVolume = 0
          for (let iCal = 0; iCal < nom.length; iCal++) {
            for (let iCalZone = 0; iCalZone < nom[iCal]?.zone.length; iCalZone++) {
              if(nom[iCal]?.zone[iCalZone]?.data_temp["9"] === "MMBTU/D"){
                if(nom[iCal]?.zone[iCalZone]?.entry_exit_text === "Entry"){
                  const valueDT = Number(nom[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                  nomEntry = nomEntry + valueDT
                }else{
                  const valueDT = Number(nom[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                  nomExit = nomExit + valueDT
                }
              }
            }
          }

          for (let iCal = 0; iCal < concept.length; iCal++) {
            for (let iCalZone = 0; iCalZone < concept[iCal]?.zone.length; iCalZone++) {
              if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Park"){
                const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                Park = Park + valueDT
              }else if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Unpark"){
                const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                Unpark = Unpark + valueDT
              }else if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Min_Inventory_Change"){
                const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                MinInventoryChange = MinInventoryChange + valueDT
              }else if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Shrinkage_Volume"){
                const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp["38"]?.replace(/,/g, ''))
                ShrinkageVolume = ShrinkageVolume + valueDT
              }
            }
          }
         
          // calcData = nomEntry - nomExit - MinInventoryChange - Park + Unpark - ShrinkageVolume
          calcData = nomEntry - nomExit

       
          return calcData;
        }else{

          // weekly ทำที่ weeklyDay
          return 0;
        }
      }

      const startDate = dayjs(eData?.gas_day_text, "DD/MM/YYYY");
      // สร้าง object
      const weeklyDay: any = {};

      daysOfWeek.forEach((day, index) => {
        const capacityRightMMBTUDWeek = (date:any, noms:any) => {
          const areaBJR = noms?.map((brj:any) => brj?.area_text)
          const matchVersionCode = contractCodeData?.flatMap((ccd:any) => {
            const ccdVersion = ccd?.booking_version?.map((ccdV:any) => {
              const dateOne = dayjs(date, "DD/MM/YYYY").format("01/MM/YYYY")
              const keyDate = ccdV?.booking_full_json[0]?.data_temp?.headerExit["Capacity Daily Booking (MMBTU/d)"][dateOne]?.key || null
              // const brjExit = ccdV?.booking_row_json?.filter((f:any) => f?.entry_exit_id === 2)
              const brjExit = ccdV?.booking_row_json?.filter((f:any) => areaBJR.includes(f?.area_text))
              let calcContract = 0
              if(keyDate){
                calcContract = brjExit.reduce(
                  (accumulator, currentValue) => accumulator + Number(currentValue?.["data_temp"]?.[keyDate]?.replace(/,/g, '') || 0),
                  0,
                );
                
              }
              return calcContract
            })
           
            return [
              ...ccdVersion,
            ]
          }).reduce(
            (accumulator, currentValue) => accumulator + currentValue,
            0,
          );
  
          return matchVersionCode
        };

        const nomCalcWeek = (gasDay:any, noms:any, nomType:any) => {
          if(nomType === 2){
            // weekly
            const nom = [...noms.map((eNo:any) => eNo?.nominaionPointZone)].flat()
            let calcData = 0
            for (let iCal = 0; iCal < nom.length; iCal++) {
              for (let iCalZone = 0; iCalZone < nom[iCal]?.zone.length; iCalZone++) {
              
                const foundEntry = Object.entries(nom[iCal]?.zone[iCalZone]?.headData || {}).find(([key, value]) => { 
                  return value?.toString().trim() === gasDay.toString().trim()
                 });
                const headDataDTKey = foundEntry ? foundEntry[0] : undefined;
                if(nom[iCal]?.zone[iCalZone]?.data_temp["9"] === "MMBTU/D"){
                  const valueDT = headDataDTKey ? Number(nom[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) : 0
                  calcData = calcData + valueDT
                }
              }
            }
            return calcData;
          }
        }

        const imbalanceMMBTUDCalcWeek = (gasDay:any, noms:any, nomType:any) => {
          // console.log('noms : ', noms);
          const nom = [...noms.map((eNo:any) => eNo?.nominaionPointZone)].flat()
          const concept = [...noms.map((eNo:any) => eNo?.conceptPointZone)].flat()
          // nom?.nomination_type_id
          // Park
          // Unpark
          // Min_Inventory_Change
          // Shrinkage_Volume
          // entry - exit - Min_Inventory_Change - Park + Unpark - Shrinkage_Volume
          if(nomType === 2){
            // weekly
            let calcData = 0
            let nomEntry = 0
            let nomExit = 0
            let Park = 0
            let Unpark = 0
            let MinInventoryChange = 0
            let ShrinkageVolume = 0
            for (let iCal = 0; iCal < nom.length; iCal++) {
              for (let iCalZone = 0; iCalZone < nom[iCal]?.zone.length; iCalZone++) {
                const foundEntry = Object.entries(nom[iCal]?.zone[iCalZone]?.headData || {}).find(([key, value]) => { 
                  return value?.toString().trim() === gasDay.toString().trim()
                 });
                const headDataDTKey = foundEntry ? foundEntry[0] : undefined;
                 if(nom[iCal]?.zone[iCalZone]?.data_temp["9"] === "MMBTU/D"){
                  if(nom[iCal]?.zone[iCalZone]?.entry_exit_text === "Entry"){
                    const valueDT = Number(nom[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) || 0
                    nomEntry = nomEntry + valueDT
                  }else{
                    const valueDT = Number(nom[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) || 0
                    nomExit = nomExit + valueDT
                  }
                }
              }
            }
  
            for (let iCal = 0; iCal < concept.length; iCal++) {
              for (let iCalZone = 0; iCalZone < concept[iCal]?.zone.length; iCalZone++) {
                const foundEntry = Object.entries(nom[iCal]?.zone[iCalZone]?.headData || {}).find(([key, value]) => { 
                  return value?.toString().trim() === gasDay.toString().trim()
                 });
                const headDataDTKey = foundEntry ? foundEntry[0] : undefined;

                if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Park"){
                  const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) || 0
                  Park = Park + valueDT
                }else if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Unpark"){
                  const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) || 0
                  Unpark = Unpark + valueDT
                }else if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Min_Inventory_Change"){
                  const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) || 0
                  MinInventoryChange = MinInventoryChange + valueDT
                }else if(concept[iCal]?.zone[iCalZone]?.data_temp["5"] === "Shrinkage_Volume"){
                  const valueDT = Number(concept[iCal]?.zone[iCalZone]?.data_temp[headDataDTKey]?.replace(/,/g, '')) || 0
                  ShrinkageVolume = ShrinkageVolume + valueDT
                }
              }
            }
           
            // calcData = nomEntry - nomExit - MinInventoryChange - Park + Unpark - ShrinkageVolume
            calcData = nomEntry - nomExit
            return calcData || 0;
          }else{
            return 0
          }
  
        }
       
       const capacityRightMMBTUD = capacityRightMMBTUDWeek(startDate.add(index, 'day').format("DD/MM/YYYY"), resultGroupAreaExt)
       const imbalanceMMBTUD = imbalanceMMBTUDCalcWeek(startDate.add(index, 'day').format("DD/MM/YYYY"), resultGroupAreaExt, nomination_type_id)
       const nominatedValueMMBTUD = nomCalcWeek(startDate.add(index, 'day').format("DD/MM/YYYY"), resultGroupAreaExt, nomination_type_id)
      //  const overusageMMBTUD = nominatedValueMMBTUD - capacityRightMMBTUD > 0 ? (nominatedValueMMBTUD - capacityRightMMBTUD) : 0
       const overusageMMBTUDWeeklySum = resultGroupAreaExt.reduce(
        (accumulator, currentValue) => accumulator + Number(currentValue?.weeklyDay[day]?.overusageMMBTUD || 0),
        0,
      )
     
       weeklyDay[day] = {
          gas_day_text: startDate.add(index, 'day').format("DD/MM/YYYY"),
          capacityRightMMBTUD: capacityRightMMBTUD,
          nominatedValueMMBTUD: nominatedValueMMBTUD,
          overusageMMBTUD: overusageMMBTUDWeeklySum,
          imbalanceMMBTUD: imbalanceMMBTUD,
        };
      });
      // overusageMMBTUD
      const capacityRightMMBTUDDaily = capacityRightMMBTUD(eData?.gas_day_text, resultGroupAreaExt)
      const nominatedValueMMBTUDDaily = nomCalc(resultGroupAreaExt, nomination_type_id)
      // const overusageMMBTUDDaily = nominatedValueMMBTUDDaily - capacityRightMMBTUDDaily > 0 ? (nominatedValueMMBTUDDaily - capacityRightMMBTUDDaily) : 0
      const overusageMMBTUDDaily = resultGroupAreaExt.reduce(
        (accumulator, currentValue) => accumulator + Number(currentValue?.overusageMMBTUD || 0),
        0,
      )

      const imbalanceMMBTUDDaily = imbalanceMMBTUDCalc(resultGroupAreaExt, nomination_type_id)
      return {
        id: ix + 1,
        dataRow: resultGroupAreaExt,
        ...eData,
        contractAll,
        capacityRightMMBTUD: capacityRightMMBTUDDaily,
        nominatedValueMMBTUD: nominatedValueMMBTUDDaily,
        overusageMMBTUD: overusageMMBTUDDaily,
        imbalanceMMBTUD: imbalanceMMBTUDDaily,
        weeklyDay,
      };
    });
    console.timeEnd('resultGroupKeyAddArea');

    
    // console.log('response size MB:', JSON.stringify(resultGroupKeyAddArea).length / 1024 / 1024);
    // console.log('resultGroupKeyAddArea : ', resultGroupKeyAddArea);
    // const nresultGroupKeyAddArea = resultGroupKeyAddArea?.map((e:any) => {
    //   e["dataRow"] = e["dataRow"]?.map((eDR:any) => {
    //     // conceptPointZone
    //     // nominaionPointZone

    //     // zone

    //     return {
    //       ...eDR
    //     }
    //   })
    //   return {
    //     ...e
    //   }
    // })

    // areaObj


    return resultGroupKeyAddArea;
  }
}
