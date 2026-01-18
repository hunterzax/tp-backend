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

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import { getTodayEndAdd7, getTodayNowAdd7, getTodayNowDDMMYYYYDfaultAdd7, getTodayStartAdd7 } from 'src/common/utils/date.util';
import { BalancingService } from 'src/balancing/balancing.service';
import { isMatch } from 'src/common/utils/allcation.util';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class ParkingAllocationService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly balancingService: BalancingService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) { }
  // parkAllocatedMMBTUD
  async findAll(payload: any) {
    const { gas_day } = payload;

    const getUsePark = await this.getUsePark({ gas_day })
    const getUseParkD1 = await this.getUsePark({ gas_day: dayjs(gas_day, "YYYY-MM-DD").subtract(1, "day").format("YYYY-MM-DD") })
    // console.log('getUsePark : ', getUsePark);
    // console.log('getUseParkD1 : ', getUseParkD1);
        // ['EODValueD-1']: null,

    const ngetUsePark = getUsePark?.map((e: any) => {
      const findZone = getUseParkD1?.find((f: any) => {
        return (
          f?.zone === e?.zone
        )
      })
      let EODSum = null
      // findZone
      if (findZone) {
        
        const ckNotNull = findZone?.data?.filter((f: any) => f?.EODPark !== null)
        if (ckNotNull.length > 0) {
          // ไม่ใช้ null ทั้งหมด ต้องไม่ส่ง null
          EODSum = ckNotNull?.reduce(
            (accumulator, currentValue) => accumulator + currentValue?.EODPark,
            0,
          );
        } else {
          EODSum = null
        }
      }
      return {
        ...e,
        ["dataParkD-1"]: findZone || null,
        ['EODValueSumD-1']: EODSum !== null ? EODSum : null,
      }
    })

    return ngetUsePark
  }

  async getUsePark(payload: any) {
    const { gas_day } = payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    
    const gas_dayS = gas_day
    const targetDate = dayjs(gas_day).startOf('day');
    const nextDate = targetDate.add(1, 'day');

    // Calculate previous Sunday for weekly nominations
    const previousSunday = targetDate.subtract(targetDate.day(), 'day').startOf('day');
    const nextSunday = previousSunday.add(1, 'week');

    const nominationMaster = await this.prisma.query_shipper_nomination_file.findMany(
      {
        where: {

          // nomination_type_id: 1,

          AND: [
            {
              OR: [{ del_flag: false }, { del_flag: null }],
            },
            {
              OR: [
                {
                  query_shipper_nomination_status_id: 2
                },
                {
                  query_shipper_nomination_status_id: 5,
                },
              ]
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
                        gte: targetDate.toDate(),
                        lt: nextDate.toDate(),
                      }
                    }
                  ]
                }
              ]
            }
          ],
          // gas_day: {
          //   gte: targetDate.toDate(),
          //   lt: nextDate.toDate(),
          // },
        },
        include: {
          group: {
            select: {
              id: true,
              id_name: true,
              name: true,
            },
          },
          contract_code: {
            select: {
              id: true,
              contract_code: true,
            },
          },
          nomination_type: true,
          nomination_version: {
            where: {
              flag_use: true,
            },
            include: {
              nomination_full_json: true,
              // nomination_full_json_sheet2:true,
              nomination_row_json: true,
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
      },
    );

    // Filter weekly nominations based on presence of daily nominations
    const nomination = nominationMaster.filter(nomination => {
      if (nomination.nomination_type_id === 2) { // If it's a week nomination
        // Check if there's a daily nomination for the same contract_code_id
        const hasDailyNomination = nominationMaster.some(dailyNom => 
          dailyNom.nomination_type_id === 1 && 
          dailyNom.contract_code_id === nomination.contract_code_id
        );
        return !hasDailyNomination; // Only keep weekly nominations that not have a corresponding daily nomination
      }
      return true; // Keep all daily nominations
    });

    const zoneData = await this.prisma.zone.findMany({
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
      },
    });

    const parkAllocatedList = await this.prisma.park_allocated.findMany({
      where: { 
        flag_use: true,
        gas_day: targetDate.toDate()
       },
      include: {
        zone: true,
      },
    });

    const yesterdayParkAllocatedList = await this.prisma.park_allocated.findMany({
      where: { 
        flag_use: true,
        gas_day: targetDate.subtract(1, 'day').toDate()
       },
      include: {
        zone: true,
      },
    });

    const parkDefaultAll = await this.parkDefaultAll()

    const newDataS = nomination.flatMap((e: any) => {
      // console.log('e : ', e);
      let check_gas_day = false

      let gas_day = dayjs(e?.gas_day).format('DD/MM/YYYY');
      const rowJson = e['nomination_version'][0]?.['nomination_row_json'].map(
        (nJ: any) => {
          nJ['data_temp'] = JSON.parse(nJ['data_temp']);
          return { ...nJ };
        },
      );
     

      const park = rowJson?.filter((f: any) => {
        return f?.data_temp['5'] === 'Park';
      }) || [];
      const unpark = rowJson?.filter((f: any) => {
        return f?.data_temp['5'] === 'Unpark';
      }) || [];
      // console.log('park : ', park);
      // console.log('unpark : ', unpark);
      const { nomination_version, ...nE } = e;
      
      let nNomination_version = null;
      let nomination_full_json = null;
      let nomination_row_json = null;

      if (nomination_version && nomination_version.length > 0) {
        const {
          nomination_full_json: full_json,
          nomination_row_json: row_json,
          ...version
        } = nomination_version[0];
        nNomination_version = version;
        nomination_full_json = full_json;
        nomination_row_json = row_json;
      }

      let parkUse = []
      let unparkUse = []
      if (e?.nomination_type?.id === 1) {
        parkUse = park.map((p: any) => {
          const query_shipper_nomination_file_id = e?.id;
          const nomination_code = e?.nomination_code;
          const group = e?.group;
          const contract_code = e?.contract_code;
          const nomination_type = e?.nomination_type;
          const version = nNomination_version;
          const zone = p['data_temp']['0'];
          const value = p['data_temp']['38'];
          const nomination_row_json_id = p?.id;
  
          return {
            nomination_row_json_id,
            nomination_code,
            gas_day,
            zone,
            query_shipper_nomination_file_id,
            group,
            contract_code,
            nomination_type,
            version,
            nomination_row_json: p,
            type: 'Park',
            value,
          };
        });
  
        unparkUse = unpark.map((p: any) => {
          const query_shipper_nomination_file_id = e?.id;
          const nomination_code = e?.nomination_code;
          const group = e?.group;
          const contract_code = e?.contract_code;
          const nomination_type = e?.nomination_type;
          const version = nNomination_version;
          const zone = p['data_temp']['0'];
          const value = p['data_temp']['38'];
          const nomination_row_json_id = p?.id;
  
          return {
            nomination_row_json_id,
            nomination_code,
            gas_day,
            zone,
            query_shipper_nomination_file_id,
            group,
            contract_code,
            nomination_type,
            version,
            nomination_row_json: p,
            type: 'Unpark',
            value,
          };
        });
        
      } else {
        parkUse = park.map((p: any) => {
          const query_shipper_nomination_file_id = e?.id;
          const nomination_code = e?.nomination_code;
          const group = e?.group;
          const contract_code = e?.contract_code;
          const nomination_type = e?.nomination_type;
          const version = nNomination_version;
          const zone = p['data_temp']['0'];
          // let value = p['data_temp']['14'];
          let value = ""
          const nomination_row_json_id = p?.id;
          // gas_day Thu May 15 2025 20:35:37 GMT+0700 (Indochina Time) dayjs(gas_day).toDate()
          // gas_day
          // dayjs(f?.gas_day).format("YYYY-MM-DD")
       
          if (dayjs(e?.gas_day).add(0, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['14']
           check_gas_day = true


          } else if (dayjs(e?.gas_day).add(1, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['15']
           check_gas_day = true


          } else if (dayjs(e?.gas_day).add(2, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['16']
           check_gas_day = true


          } else if (dayjs(e?.gas_day).add(3, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['17']
           check_gas_day = true


          } else if (dayjs(e?.gas_day).add(4, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['18']
           check_gas_day = true


          } else if (dayjs(e?.gas_day).add(5, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['19']
           check_gas_day = true


          } else if (dayjs(e?.gas_day).add(6, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['20']
           check_gas_day = true


          } else {

            return null
          }
          if (check_gas_day) {
            console.log('++++++++');
            gas_day = dayjs(gas_dayS, "YYYY-MM-DD").format("DD/MM/YYYY")
          }
          return {
            nomination_row_json_id,
            nomination_code,
            gas_day,
            zone,
            query_shipper_nomination_file_id,
            group,
            contract_code,
            nomination_type,
            version,
            nomination_row_json: p,
            type: 'Park',
            value,
          };
        })?.filter((f: any) => { return f !== null });

  
        unparkUse = unpark.map((p: any) => {
          const query_shipper_nomination_file_id = e?.id;
          const nomination_code = e?.nomination_code;
          const group = e?.group;
          const contract_code = e?.contract_code;
          const nomination_type = e?.nomination_type;
          const version = nNomination_version;
          const zone = p['data_temp']['0'];
          // const value = p['data_temp']['14'];
          let value = ""
          const nomination_row_json_id = p?.id;

          if (dayjs(e?.gas_day).add(0, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['14']
            check_gas_day = true


          } else if (dayjs(e?.gas_day).add(1, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['15']
            check_gas_day = true


          } else if (dayjs(e?.gas_day).add(2, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['16']
            check_gas_day = true


          } else if (dayjs(e?.gas_day).add(3, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['17']
            check_gas_day = true


          } else if (dayjs(e?.gas_day).add(4, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['18']
            check_gas_day = true


          } else if (dayjs(e?.gas_day).add(5, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['19']
            check_gas_day = true


          } else if (dayjs(e?.gas_day).add(6, "day").format("YYYY-MM-DD") === dayjs(gas_day, "DD/MM/YYYY").format("YYYY-MM-DD")) {
            value = p['data_temp']['20']
            check_gas_day = true


          } else {
            return null
          }
          if (check_gas_day) {
            gas_day = dayjs(gas_dayS, "YYYY-MM-DD").format("DD/MM/YYYY")
          }
  
          return {
            nomination_row_json_id,
            nomination_code,
            gas_day,
            zone,
            query_shipper_nomination_file_id,
            group,
            contract_code,
            nomination_type,
            version,
            nomination_row_json: p,
            type: 'Unpark',
            value,
          };
        })?.filter((f: any) => { return f !== null });

      }

      return [...parkUse, ...unparkUse];
    });
    // console.log('newData : ', newDataS);
    const newData = newDataS?.filter((f: any) => { return dayjs(f?.gas_day, "DD/MM/YYYY").format("YYYY-MM-DD") === gas_day })


    const groupedByZone = Object.values(
      newData.reduce((acc, item) => {
        const key = item.zone;
        if (!acc[key]) {
          acc[key] = {
            zone: key,
            data: [],
          };
        }
        acc[key].data.push(item);
        return acc;
      }, {}),
    );


    const groupNom = groupedByZone.map((e: any) => {
      const { data, ...eN } = e;

      // zoneData
      const zoneObj =
        zoneData?.find((f: any) => {
          return f?.name === eN?.zone;
        }) || null;

      const findAllocated = parkAllocatedList.find((f: any) => { return isMatch(f?.zone?.name, eN?.zone) })

      const groupedByNom = Object.values(
        data.reduce((acc, item) => {
          const key = item.nomination_code;
          if (!acc[key]) {
            acc[key] = {
              query_shipper_nomination_file_id:
                item?.query_shipper_nomination_file_id,
              nomination_code: key,
              gas_day: item?.gas_day,
              data: [],
            };
          }
          acc[key].data.push(item);
          return acc;
        }, {}),
      );

      const parkUseCaleSumAll = groupedByNom
        ?.flatMap((puc: any) => [...puc?.data])
        ?.filter((fPuc: any) => fPuc?.type === 'Park')
        .reduce((ar: any, mr: any) => ar + Number(Number(mr?.value?.replace(/,/g, '')).toFixed(3)), 0);

      const nGroupedByNom = groupedByNom.map((nG: any) => {
        let parkAllocatedMMBTUD = null;
        const parkOnce = nG?.data
          ?.filter((fPuc: any) => fPuc?.type === 'Park')
          .reduce((ar: any, mr: any) => ar + Number(Number(mr?.value?.replace(/,/g, '')).toFixed(3)), 0);
       
        if (findAllocated) {
          console.log('parkOnce : ', parkOnce);
          console.log('parkUseCaleSumAll : ', parkUseCaleSumAll);
          console.log(parkOnce / parkUseCaleSumAll);
          parkAllocatedMMBTUD = parkOnce !== 0 ? Number((parkOnce / parkUseCaleSumAll) * Number(findAllocated?.total_parking_value)).toFixed(3) : 0;
        }

        return { parkAllocatedMMBTUD, ...nG };
      });


      let parkDefault = null
      const lastUserParkValue = yesterdayParkAllocatedList.find((f: any) => { return isMatch(f?.zone?.name, eN?.zone) })?.total_parking_value
      if (eN?.zone.toUpperCase() === 'EAST') {
        parkDefault = parkDefaultAll.find((f: any) => { return f?.system_parameter_id === 32 })
      } else if (eN?.zone.toUpperCase() === 'WEST') {
        parkDefault = parkDefaultAll.find((f: any) => { return f?.system_parameter_id === 33 })
      } else if (eN?.zone.toUpperCase() === 'EAST-WEST') {
        parkDefault = parkDefaultAll.find((f: any) => { return f?.system_parameter_id === 34 })
      }

      const group = nGroupedByNom[0]?.data[0]?.group
      const contract_code = nGroupedByNom[0]?.data[0]?.contract_code

      return { ...eN, zoneObj, group, contract_code, parkDefault, lastUserParkValue, data: nGroupedByNom };
    });

    const resData: any = await this.balancingService.balancReport({
      start_date: gas_day,
      end_date: gas_day,
      skip: "100",
      limit: "100",
    }, null);
    const balData = resData?.data || []
    // console.log('balData : ', balData);
    const flatbalData = balData?.flatMap((e: any) => {
      const shipper_data = e?.["shipper_data"]?.flatMap((sd: any) => {
        const contract_data = sd?.["contract_data"]?.map((cd: any) => {
          return {
            contract_data: cd?.contract,
            values: cd?.values,
            shipper: sd?.shipper,
            valuesAll: sd?.values, 
          }
        })
        return [
          ...contract_data,
        ]
      })

      return [
        ...shipper_data,
      ]
    })
    // console.log('groupNom : ', groupNom);
    // console.log('flatbalData : ', flatbalData);
    const ngroupNom = groupNom?.map((e: any) => {

      const { data, contract_code, group, ...nE } = e

      
      const nData = data?.map((d: any) => {
        const { data: dataPU, ...nD } = d
        const find = flatbalData?.find((f: any) => {
          return (
            f?.shipper === dataPU?.[0]?.group?.id_name &&
            f?.contract_data === dataPU?.[0]?.contract_code?.contract_code
          )
        })
        const findValue = find && find?.values || []
        let eodValue = null
        if (e?.zone.toUpperCase() === "EAST") {
          eodValue = findValue?.find((f: any) => f?.tag === "EodPark_east")?.value
        } else if (e?.zone.toUpperCase() === "WEST") {
          eodValue = findValue?.find((f: any) => f?.tag === "EodPark_west")?.value
        }

        return {
          ...nD,
          EODPark: eodValue !== null && eodValue || null,
          data: dataPU,
        }
      })

      return {
        ...nE,
        data: nData,
      }
    })

    return ngroupNom;
  }

  async allocate(payload: any, userId: any) {
    const { zone_id, gas_day, total_parking_value } = payload;

    let targetDate = dayjs(gas_day, 'DD/MM/YYYY').startOf('day');
    if (!targetDate.isValid()) {
      targetDate = dayjs(gas_day).startOf('day');
    }
    const nextDate = targetDate.add(1, 'day');

    const findAllocated = await this.prisma.park_allocated.findFirst({
      where: {
        zone_id: Number(zone_id),
        gas_day: {
          gte: targetDate.toDate(),
          lt: nextDate.toDate(),
        },
      },
    });
    console.log('findAllocated : ', findAllocated);

    if (findAllocated) {
      let gasDay = getTodayNowDDMMYYYYDfaultAdd7(gas_day)
      if (!gasDay.isValid()) {
        gasDay = getTodayNowAdd7(gas_day)
      }
      await this.prisma.park_allocated.updateMany({
        where: {
          zone_id: Number(zone_id),
          gas_day: gasDay.toDate(),
          // total_parking_value: String(total_parking_value.replace(/,/g, ''))
        },
        data: {
          flag_use: null,
        },
      });

      const create = await this.prisma.park_allocated.create({
        data: {
          flag_use: true,
          zone: {
            connect: {
              id: Number(zone_id),
            },
          },
          total_parking_value: total_parking_value,
          gas_day: getTodayNowDDMMYYYYDfaultAdd7(gas_day).toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      return create;
    } else {
      let gasDay = getTodayNowDDMMYYYYDfaultAdd7(gas_day)
      if (!gasDay.isValid()) {
        gasDay = getTodayNowAdd7(gas_day)
      }
      const create = await this.prisma.park_allocated.create({
        data: {
          flag_use: true,
          zone: {
            connect: {
              id: Number(zone_id),
            },
          },
          total_parking_value: total_parking_value,
          gas_day: gasDay.toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      return create;
    }
  }

  async parkDefaultAll() {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
  

    return this.prisma.system_parameter.findMany({
      where: {
        AND: [
          {
            system_parameter_id: {
              in: [32, 33, 34],
            },
          },
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
        system_parameter: true,
      },
    });

    // const allocate = await this.prisma.park_allocated.findFirst({ where: { id: Number(zone_id) } })
    // return allocate
  }

  async parkDefault(payload: any) {
    const { zone_id } = payload;
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const zone = await this.prisma.zone.findFirst({
      where: { id: Number(zone_id) },
    });

    if (zone?.name.toUpperCase() === 'EAST') {
      return this.prisma.system_parameter.findFirst({
        where: {
          system_parameter_id: 32,
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
          system_parameter: true,
        },
      });
    } else if (zone?.name.toUpperCase() === 'WEST') {
      return this.prisma.system_parameter.findFirst({
        where: {
          system_parameter_id: 33,
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
          system_parameter: true,
        },
      });
    } else if (zone?.name.toUpperCase() === 'EAST-WEST') {
      return this.prisma.system_parameter.findFirst({
        where: {
          system_parameter_id: 34,
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
          system_parameter: true,
        },
      });
    } else {
      return null;
    }

    // const allocate = await this.prisma.park_allocated.findFirst({ where: { id: Number(zone_id) } })
    // return allocate
  }
}
