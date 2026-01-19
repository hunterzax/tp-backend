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
import { getTodayEndAdd7, getTodayNowDDMMYYYYAdd7, getTodayStartAdd7 } from 'src/common/utils/date.util';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class MinimumInventorySummaryService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
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

  async findAll(payload: any) {
    const { gas_day } = payload;
    const daysOfWeek = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const targetDate = dayjs(gas_day).startOf('day');
    const nextDate = targetDate.add(1, 'day');

    // Calculate previous Sunday for weekly nominations
    const previousSunday = targetDate.subtract(targetDate.day(), 'day').startOf('day');
    const nextSunday = previousSunday.add(1, 'day');

    const nomination = await this.prisma.query_shipper_nomination_file.findMany(
      {
        where: {
          // nomination_type_id: 1,
          query_shipper_nomination_status: {
            id: { in: [2, 5] },
          },
          AND: [
            {
              OR: [{ del_flag: false }, { del_flag: null }],
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

    console.log('nomination : ', nomination);

    const newData = nomination.flatMap((e: any) => {
      // console.log('e : ', e);
      const gas_day = dayjs(e?.gas_day).format('DD/MM/YYYY');
      const rowJson = e?.['nomination_version']?.[0]?.['nomination_row_json']?.map(
        (nJ: any) => {
          nJ['data_temp'] = this.safeParseJSON(nJ['data_temp']);
          return { ...nJ };
        },
      ) || [];
      // Min_Inventory_Change
      // Exchange_Mininventory
      const MinInventoryChange = rowJson?.filter((f: any) => {
        return f?.data_temp?.['5'] === 'Min_Inventory_Change';
      }) || [];
      const ExchangeMininventory = rowJson?.filter((f: any) => {
        return f?.data_temp?.['5'] === 'Exchange_Mininventory';
      }) || [];
      // console.log('MinInventoryChange : ', MinInventoryChange);
      // console.log('ExchangeMininventory : ', ExchangeMininventory);
      const { nomination_version, ...nE } = e;
      const {
        nomination_full_json,
        nomination_row_json,
        ...nNomination_version
      } = nomination_version?.[0] || {};

      let MinInventoryChangeUse = [];
      let ExchangeMininventoryUse = [];

      if (e?.nomination_type?.id === 1) {
        MinInventoryChangeUse = MinInventoryChange.map((p: any) => {
          const query_shipper_nomination_file_id = e?.id;
          const nomination_code = e?.nomination_code;
          const group = e?.group;
          const contract_code = e?.contract_code;
          const nomination_type = e?.nomination_type;
          const version = nNomination_version;
          const zone = p?.['data_temp']?.['0'];
          let value = p?.['data_temp']?.['38'] || null;
          value = value?.trim()?.replace(/,/g, '');
          // Check if value is wrapped in parentheses and convert to negative
          if (value && value.startsWith('(') && value.endsWith(')')) {
            value = '-' + value.slice(1, -1); // Remove parentheses and add negative sign
          }
          const nomination_row_json_id = p?.id;

          const nomType = 'daily';

          return {
            nomination_row_json_id,
            nomination_code,
            gas_day,
            gas_day_main: gas_day,
            zone,
            query_shipper_nomination_file_id,
            group,
            contract_code,
            nomination_type,
            version,
            nomination_row_json: p,
            type: 'Min_Inventory_Change',
            value: Number(value) || null,
            nomType,
          };
        });

        ExchangeMininventoryUse = ExchangeMininventory.map((p: any) => {
          const query_shipper_nomination_file_id = e?.id;
          const nomination_code = e?.nomination_code;
          const group = e?.group;
          const contract_code = e?.contract_code;
          const nomination_type = e?.nomination_type;
          const version = nNomination_version;
          const zone = p?.['data_temp']?.['0'];
          const value = p?.['data_temp']?.['38'] || null;
          const nomination_row_json_id = p?.id;

          const nomType = 'daily';

          return {
            nomination_row_json_id,
            nomination_code,
            gas_day,
            gas_day_main: gas_day,
            zone,
            query_shipper_nomination_file_id,
            group,
            contract_code,
            nomination_type,
            version,
            nomination_row_json: p,
            type: 'Exchange_Mininventory',
            value: Number(value?.trim()?.replace(/,/g, '')) || null,
            nomType,
          };
        });
      } else {
        daysOfWeek.forEach((day, index) => {
          MinInventoryChange.map((p: any) => {
            const query_shipper_nomination_file_id = e?.id;
            const nomination_code = e?.nomination_code;
            const group = e?.group;
            const contract_code = e?.contract_code;
            const nomination_type = e?.nomination_type;
            const version = nNomination_version;
            const zone = p?.['data_temp']?.['0'];
            let value = p?.['data_temp']?.[`${14 + index}`] || null;
            value = value?.trim()?.replace(/,/g, '');
            // Check if value is wrapped in parentheses and convert to negative
            if (value && value.startsWith('(') && value.endsWith(')')) {
              value = '-' + value.slice(1, -1); // Remove parentheses and add negative sign
            }
            const nomination_row_json_id = p?.id;

            const nomType = day;
            const startDate = dayjs(gas_day, 'DD/MM/YYYY');

            MinInventoryChangeUse.push({
              nomination_row_json_id,
              nomination_code,
              gas_day: startDate.add(index, 'day').format('DD/MM/YYYY'),
              gas_day_main: gas_day,
              zone,
              query_shipper_nomination_file_id,
              group,
              contract_code,
              nomination_type,
              version,
              nomination_row_json: p,
              type: 'Min_Inventory_Change',
              value: Number(value) || null,
              nomType,
            });

            return {
              nomination_row_json_id,
              nomination_code,
              gas_day: startDate.add(index, 'day').format('DD/MM/YYYY'),
              zone,
              query_shipper_nomination_file_id,
              group,
              contract_code,
              nomination_type,
              version,
              nomination_row_json: p,
              type: 'Min_Inventory_Change',
              value: Number(value?.trim()?.replace(/,/g, '')) || null,
              nomType,
            };
          });

          ExchangeMininventory.map((p: any) => {
            const query_shipper_nomination_file_id = e?.id;
            const nomination_code = e?.nomination_code;
            const group = e?.group;
            const contract_code = e?.contract_code;
            const nomination_type = e?.nomination_type;
            const version = nNomination_version;
            const zone = p?.['data_temp']?.['0'];
            const value = p?.['data_temp']?.[`${14 + index}`] || null;
            const nomination_row_json_id = p?.id;

            const nomType = day;
            const startDate = dayjs(gas_day, 'DD/MM/YYYY');

            ExchangeMininventoryUse.push({
              nomination_row_json_id,
              nomination_code,
              gas_day: startDate.add(index, 'day').format('DD/MM/YYYY'),
              gas_day_main: gas_day,
              zone,
              query_shipper_nomination_file_id,
              group,
              contract_code,
              nomination_type,
              version,
              nomination_row_json: p,
              type: 'Exchange_Mininventory',
              value: Number(value?.trim()?.replace(/,/g, '')) || null,
              nomType,
            });

            return {
              nomination_row_json_id,
              nomination_code,
              gas_day: startDate.add(index, 'day').format('DD/MM/YYYY'),
              zone,
              query_shipper_nomination_file_id,
              group,
              contract_code,
              nomination_type,
              version,
              nomination_row_json: p,
              type: 'Exchange_Mininventory',
              value: Number(value?.trim()?.replace(/,/g, '')) || null,
              nomType,
            };
          });
        });
      }

      return [...MinInventoryChangeUse, ...ExchangeMininventoryUse];
    });

    // return newData;

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

    const nDelWkeeklyD = groupedByZone?.map((e: any) => {
      const { data, ...nE } = e;
      const nData = [];
      for (let iW = 0; iW < data.length; iW++) {
        if (data?.[iW]?.nomination_type?.id === 1) {
          nData?.push({ ...data?.[iW] });
        } else {
          const find = data?.find((f: any) => {
            return (
              f?.nomination_type?.id === 1 &&
              f?.nomination_code === data?.[iW]?.nomination_code &&
              f?.gas_day === data?.[iW]?.gas_day &&
              f?.group?.name === data?.[iW]?.group?.name &&
              f?.contract_code?.contract_code ===
              data?.[iW]?.contract_code?.contract_code
            );
          });
          if (!find) {
            nData?.push({ ...data?.[iW] });
          }
        }
      }

      return {
        ...nE,
        data: nData,
      };
    });

    const groupNom = nDelWkeeklyD.map((e: any) => {
      const { data, ...eN } = e;

      const zoneObj =
        zoneData?.find((f: any) => {
          return f?.name === eN?.zone;
        }) || null;

      // Min_Inventory_Change
      // Exchange_Mininventory

      const daily = data?.filter((f: any) => {
        return f?.nomination_type?.id === 1;
      });
      const weekly = data?.filter((f: any) => {
        return f?.nomination_type?.id === 2;
      });

      return { ...eN, zoneObj, daily, weekly };
    });

    // const find = data?.find((f: any) => {
    //   return (
    //     f?.nomination_type?.id === 1 &&
    //     f?.nomination_code === data?.[iW]?.nomination_code &&
    //     f?.gas_day === data?.[iW]?.gas_day &&
    //     f?.group?.name === data?.[iW]?.group?.name &&
    //     f?.contract_code?.contract_code ===
    //       data?.[iW]?.contract_code?.contract_code
    //   );
    // });

    const groupCX = groupNom?.map((e: any) => {

      const groupedByDaily = Object.values(
        e["daily"].reduce((acc, item) => {
          const key = `${item.gas_day}|${item.group?.name}|${item?.contract_code?.contract_code}`;
          if (!acc[key]) {
            acc[key] = {
              nomination_code: item.nomination_code,
              gas_day: item.gas_day,
              gas_day_main: item.gas_day_main,
              group: item.group?.name,
              contract_code: item.contract_code.contract_code,
              data: [],
            };
          }
          if (item.type === 'Min_Inventory_Change') {
            acc[key].minInven = acc[key].minInven ? acc[key].minInven + item.value : item.value;
          } else if (item.type === 'Exchange_Mininventory') {
            acc[key].exchangeMinInven = acc[key].exchangeMinInven ? acc[key].exchangeMinInven + item.value : item.value;
          }
          acc[key].data.push(item);
          return acc;
        }, {}),
      );

      const groupedByWeekly = Object.values(
        e["weekly"].reduce((acc, item) => {
          const key = `${item.gas_day}|${item.group?.name}|${item?.contract_code?.contract_code}`;
          if (!acc[key]) {
            acc[key] = {
              nomination_code: item.nomination_code,
              gas_day: item.gas_day,
              gas_day_main: item.gas_day_main,
              group: item.group?.name,
              contract_code: item.contract_code.contract_code,
              minInven: null,
              exchangeMinInven: null,
              data: [],
            };
          }
          if (item.type === 'Min_Inventory_Change') {
            acc[key].minInven = acc[key].minInven ? acc[key].minInven + item.value : item.value;
          } else if (item.type === 'Exchange_Mininventory') {
            acc[key].exchangeMinInven = acc[key].exchangeMinInven ? acc[key].exchangeMinInven + item.value : item.value;
          }
          acc[key].data.push(item);
          return acc;
        }, {}),
      );

      const { daily, weekly, ...nE } = e

      return {
        ...nE,
        groupedByDaily,
        groupedByWeekly,
      }
    })

    // groupedByAll

    // console.log('groupCX : ', groupCX);
    // gas_day
    // groupedByDaily
    // groupedByWeekly
    // console.log('dayjs(gas_day).format("DD/MM/YYYY") : ', dayjs(gas_day).format("DD/MM/YYYY"));
    const filgroupCX = groupCX?.map((e: any) => {
      e["groupedByDaily"] = e["groupedByDaily"]?.filter((f: any) => {
        return (
          f?.gas_day === dayjs(gas_day).format("DD/MM/YYYY")
        )
      })
      // e["groupedByWeekly"] = e["groupedByWeekly"]?.filter((f:any) => {
      //   return (
      //     f?.gas_day_main === dayjs(gas_day).format("DD/MM/YYYY")
      //   )
      // })
      return {
        ...e,
      }
    })

    const groupAll = filgroupCX?.map((e: any) => {

      // สร้าง set หรือ map เพื่อใช้ตรวจสอบรายการที่มีอยู่ใน daily
      const dailyKeySet = new Set(
        e["groupedByDaily"].map(item => `${item.gas_day}|${item.group}|${item.contract_code}`)
      )

      // กรอง weekly ให้เหลือเฉพาะที่ไม่อยู่ใน daily
      const notInDaily = e["groupedByWeekly"].filter(item => {
        const key = `${item.gas_day}|${item.group}|${item.contract_code}`
        return !dailyKeySet.has(key)
      })

      // console.log('d : ', e["groupedByDaily"]);
      // console.log('w : ', e["groupedByWeekly"]);
      // console.log(notInDaily);
      const groupedByAll = [...e["groupedByDaily"], ...notInDaily]
      // console.log(groupedByAll);
      return {
        ...e,
        groupedByAll
      }
    })

    // console.log('groupAll : ', groupAll);

    const filgroupAll = groupAll?.map((e: any) => {
      e["groupedByAll"] = e["groupedByAll"]?.filter((f: any) => {
        return (
          f?.gas_day === dayjs(gas_day).format("DD/MM/YYYY")
        )
      })
      return {
        ...e,
      }
    })

    return filgroupAll;
  }
}
