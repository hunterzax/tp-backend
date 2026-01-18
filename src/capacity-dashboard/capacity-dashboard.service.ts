import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx-js-style';
import * as fs from 'fs';
import * as FormData from 'form-data';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'; // นำเข้า plugin isSameOrBefore
import axios from 'axios';
import { getTodayNowDDMMYYYYDfaultAdd7 } from 'src/common/utils/date.util';
dayjs.extend(isSameOrBefore); // เปิดใช้งาน plugin isSameOrBefore
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class CapacityDashboardService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) {}

  async statusProcess() {
    const resStatusProcess =
      await this.prisma.status_capacity_request_management_process.findMany({
        where: {
          id: { not: 5 },
        },
        include: {
          contract_code: true,
        },
        orderBy: {
          id: 'asc',
        },
      });
    return resStatusProcess;
  }

  async areaDataGraph(idArrStr: any) {
    const { id, start_date, end_date } = idArrStr;
    const idArrs = JSON.parse(id);
    console.log('idArrs : ', idArrs);
    const resEntryExit = await this.prisma.entry_exit.findMany({
      orderBy: {
        id: 'asc',
      },
    });

    const resArea = await this.prisma.area.findMany({
      select: {
        name: true,
        entry_exit_id: true,
        color: true,
      },
      orderBy: {
        id: 'asc',
      },
    });
    const resTermType = await this.prisma.term_type.findMany({
      select: {
        id: true,
        name: true,
        color: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const corssData = resEntryExit.map((e: any) => {
      const filterAreaData = resArea.filter((f: any) => {
        return f?.entry_exit_id === e?.id;
      });
      return { ...e, area: filterAreaData };
    });

    const resContractCode = await this.prisma.contract_code.findMany({
      where: {
        // id: { not: 5 }, // https://app.clickup.com/t/86erm0qq1
        group: {
          id: {
            in: idArrs,
          },
        },
        
        // contract_start_date: {
        //   lte: end_date ? getTodayNowDDMMYYYYDfaultAdd7(end_date).toDate() : null
        // },
        // contract_end_date: {
        //   lte: start_date ? getTodayNowDDMMYYYYDfaultAdd7(start_date).toDate() : null
        // },
      },
      include: {
        group: true,
        term_type: true,
        booking_version: {
          include: {
            booking_row_json: true,
            booking_full_json: true,
          },
          take: 1,
          orderBy: { id: 'desc' },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    console.log('resContractCode : ', resContractCode);

    // จัดเรียงข้อมูลใหม่ให้อยู่ในลำดับ booking_row_json -> booking_version -> contract_code
    // file_period_mode
    const reorderedData = [];
    for (let i = 0; i < resContractCode.length; i++) {
      const bookingVersions = resContractCode[i]?.booking_version[0];
      const bookingRowJsons =
        resContractCode[i]?.booking_version[0]?.booking_row_json;
      for (let iBRJ = 0; iBRJ < bookingRowJsons.length; iBRJ++) {
        const { booking_version, group, ...newContractCode } =
          resContractCode[i];
        const {
          booking_row_json,
          booking_full_json,
          ...newBookingVersions
        }: any = bookingVersions;
        const jsonFull = JSON.parse(booking_full_json[0]?.data_temp);
        const { data_temp, ...niBRJ } = bookingRowJsons[iBRJ];
        const newiBRJ = {
          ...niBRJ,
          rows: JSON.parse(data_temp),
          booking_version: newBookingVersions,
          booking_full_json_temp: jsonFull,
          contract_code: newContractCode,
          shipper: group,
        };
        reorderedData.push(newiBRJ);
      }
    }

    const newCorssData = corssData.map((e: any) => {
      const area = e['area'].map((eArea: any) => {
        const filterData = reorderedData.filter((f: any) => {
          return (
            f?.area_text === eArea?.name &&
            f?.entry_exit_id === eArea?.entry_exit_id
          );
        });
        const term_type = resTermType.map((eTermType: any) => eTermType);
        return { ...eArea, data: filterData, term_type };
      });
      return { ...e, area };
    });

    const calcData = newCorssData.map((e: any) => {
      const area = e['area'].map((eArea: any) => {
        const data = eArea['data'].map((eData: any) => {
          const headType =
            eData?.entry_exit_id === 1 ? 'headerEntry' : 'headerExit';
          const setData =
            eData?.booking_full_json_temp?.[headType]?.[
              'Capacity Daily Booking (MMBTU/d)'
            ];
          // อัปเดตค่าใน setData
          Object.entries(setData).forEach(([dates, datas]: any) => {
            const key = datas.key;
            if (eData?.rows[key] !== undefined) {
             
              setData[dates].value = !!eData?.rows[key] && Number(eData?.rows[key].replace(/,/g, '')) || 0; // เพิ่ม value เข้าไป 
              setData[dates].date = dayjs(dates, 'DD/MM/YYYY').format(
                'YYYY-MM-DD 00:00:00',
              ); // เพิ่ม date เข้าไป
              setData[dates].month = dayjs(dates, 'DD/MM/YYYY').format(
                'MMM YYYY',
              ); // เพิ่ม date เข้าไป
            }
          });
          delete setData.key;
          const { booking_full_json_temp, rows, booking_version, ...neData } =
            eData;

          // แปลงข้อมูลให้อยู่ในรูปแบบ array และตัด "key" ออก
          const nsetData = Object.values(setData).map(
            ({ key, ...rest }) => rest,
          );

          return { ...neData, nsetData };
        });
        return { ...eArea, data };
      });

      return { ...e, area };
    });

    const calcDataTermType = calcData.map((e: any) => {
      const area = e['area'].map((eArea: any) => {
        const term_type = eArea['term_type'].map((eTermType: any) => {
          const filterTermType = eArea['data'].filter((f: any) => {
            return f?.contract_code?.term_type?.id === eTermType?.id;
          });
          return { ...eTermType, data: filterTermType };
        });
        const { data, ...neArea } = eArea;
        return { ...neArea, term_type };
      });
      return { ...e, area };
    });
    console.log('calcDataTermType : ', calcDataTermType);
    const calcDatas = calcDataTermType.map((e: any) => {
      const area = e['area'].map((eArea: any) => {
        // console.log(`---${eArea?.name}---`);
        const term_type = eArea['term_type'].map((eTermType: any) => {
          // const data = eTermType["data"].map((eTermType:any) => {

          // })
          // ดึงค่า file_period_mode จาก data
          const filePeriodModes = eTermType['data'].map(
            (item) => item.contract_code.file_period_mode,
          );

          // เช็คเงื่อนไข
          const has1Or3 = filePeriodModes.some(
            (mode) => mode === 1 || mode === 3,
          );
          const has2 = filePeriodModes.some((mode) => mode === 2);
          const only2 = filePeriodModes.every((mode) => mode === 2);
          let conditions = [];
          if (only2) {
            //  "month"
            // 1. รวมค่า value ตาม date
            const dateSum = {};

            // eTermType['data'].forEach((item) => {
            //   item.nsetData.forEach(({ date, value, month }) => {
            //     if (!dateSum[date]) {
            //       dateSum[date] = { totalValue: 0, month };
            //     }
            //     dateSum[date].totalValue += value;
            //   });
            // });
            // console.log('1 : ', eTermType['data']);
            eTermType['data'].forEach((item) => {
              item.nsetData.forEach(({ date, value, month }) => {
                if (!dateSum[date]) {
                  dateSum[date] = { totalValue: value ?? 0, month }; // ถ้าไม่มีค่าให้ใช้ 0
                } else {
                  // console.log('dateSum[date].totalValue : ', dateSum[date].totalValue);
                  // console.log('value : ', value);
                  dateSum[date].totalValue = Math.max(dateSum[date].totalValue, value ?? 0); // ถ้า value เป็น null/undefined ให้ใช้ 0
                }
              });
            });

            // 2. จัดกลุ่มตาม month และหาค่าที่ต่ำที่สุด
            const monthMinValue = {};

            Object.values(dateSum).forEach(({ totalValue, month }: any) => {
              if (!monthMinValue[month] || totalValue < monthMinValue[month]) {
                monthMinValue[month] = totalValue;
              }
            });

            // 3. แปลงเป็น array ตามโครงสร้างที่ต้องการ
            const result = Object.entries(monthMinValue).map(
              ([month, value]) => ({
                value,
                month,
              }),
            );

            conditions = result;
          } else if (has2 && has1Or3) {
            // "ผสม"
            const daysMix = eTermType['data'].filter((item) => {
              return (
                item.contract_code.file_period_mode === 1 ||
                item.contract_code.file_period_mode === 3
              );
            });
            const monthMix = eTermType['data'].filter((item) => {
              return item.contract_code.file_period_mode === 2;
            });

            const dateSumDay = {};

            // daysMix.forEach((item) => {
            //   item.nsetData.forEach(({ date, value, month }) => {
            //     if (!dateSumDay[date]) {
            //       dateSumDay[date] = { totalValue: 0, month };
            //     }
            //     dateSumDay[date].totalValue += value;
            //   });
            // });
            console.log('2');
            daysMix.forEach((item) => {
              item.nsetData.forEach(({ date, value, month }) => {
                if (!dateSumDay[date]) {
                  dateSumDay[date] = { totalValue: value ?? 0, month }; // ถ้าไม่มีค่าให้ใช้ 0
                } else {
                  console.log('dateSumDay[date].totalValue : ', dateSumDay[date].totalValue);
                  console.log('value : ', value);
                  dateSumDay[date].totalValue = Math.max(dateSumDay[date].totalValue, value ?? 0); // ถ้า value เป็น null/undefined ให้ใช้ 0
                }
              });
            });

            // 2. จัดกลุ่มตาม month และหาค่าที่ต่ำที่สุด
            const monthMinValueDay = {};

            Object.values(dateSumDay).forEach(({ totalValue, month }: any) => {
              if (
                !monthMinValueDay[month] ||
                totalValue < monthMinValueDay[month]
              ) {
                monthMinValueDay[month] = totalValue;
              }
            });

            // 3. แปลงเป็น array ตามโครงสร้างที่ต้องการ
            const resultDay = Object.entries(monthMinValueDay).map(
              ([month, value]) => ({
                value,
                month,
              }),
            );

            // -------

            const dateSumMonth = {};

            // monthMix.forEach((item) => {
            //   item.nsetData.forEach(({ date, value, month }) => {
            //     if (!dateSumMonth[date]) {
            //       dateSumMonth[date] = { totalValue: 0, month };
            //     }
            //     dateSumMonth[date].totalValue += value;
            //   });
            // });
            console.log('3');
            monthMix.forEach((item) => {
              item.nsetData.forEach(({ date, value, month }) => {
                if (!dateSumMonth[date]) {
                  dateSumMonth[date] = { totalValue: value ?? 0, month }; // ถ้าไม่มีค่าให้ใช้ 0
                } else {
                  console.log('dateSumMonth[date].totalValue : ', dateSumMonth[date].totalValue);
                  console.log('value : ', value);
                  dateSumMonth[date].totalValue = Math.max(dateSumMonth[date].totalValue, value ?? 0); // ถ้า value เป็น null/undefined ให้ใช้ 0
                }
              });
            });

            // 2. จัดกลุ่มตาม month และหาค่าที่ต่ำที่สุด
            const monthMinValueMonth = {};

            Object.values(dateSumMonth).forEach(
              ({ totalValue, month }: any) => {
                if (
                  !monthMinValueMonth[month] ||
                  totalValue < monthMinValueMonth[month]
                ) {
                  monthMinValueMonth[month] = totalValue;
                }
              },
            );

            // 3. แปลงเป็น array ตามโครงสร้างที่ต้องการ
            const resultMonth = Object.entries(monthMinValueMonth).map(
              ([month, value]) => ({
                value,
                month,
              }),
            );

            // -------

            const monthMap = new Map();

            // ฟังก์ชันสำหรับใส่ค่าลงใน Map โดยเก็บค่าต่ำสุด
            const addToMap = (arr) => {
              arr.forEach(({ month, value }) => {
                if (!monthMap.has(month) || value < monthMap.get(month)) {
                  monthMap.set(month, value);
                }
              });
            };

            // เพิ่มข้อมูลจาก a และ b เข้าไป
            addToMap(resultDay);
            addToMap(resultMonth);

            // แปลง Map เป็น array ตามโครงสร้างที่ต้องการ
            const result = Array.from(monthMap, ([month, value]) => ({
              month,
              value,
            }));

            console.log(result);
            conditions = result;
          } else {
            // "day"
            // 1. รวมค่า value ตาม date
            const dateSum = {};

            // eTermType['data'].forEach((item) => {
            //   item.nsetData.forEach(({ date, value, month }) => {
            //     if (!dateSum[date]) {
            //       dateSum[date] = { totalValue: 0, month };
            //     }
            //     dateSum[date].totalValue += value;
            //   });
            // });
            console.log('4');
            eTermType['data'].forEach((item) => {
              item.nsetData.forEach(({ date, value, month }) => {
                if (!dateSum[date]) {
                  dateSum[date] = { totalValue: value ?? 0, month }; // ถ้าไม่มีค่าให้ใช้ 0
                } else {
                  // console.log('dateSum[date].totalValue : ', dateSum[date].totalValue);
                  // console.log('value : ', value);
                  dateSum[date].totalValue = Math.max(dateSum[date].totalValue, value ?? 0); // ถ้า value เป็น null/undefined ให้ใช้ 0
                }
              });
            });

            // 2. จัดกลุ่มตาม month และหาค่าที่ต่ำที่สุด
            const monthMinValue = {};

            Object.values(dateSum).forEach(({ totalValue, month }: any) => {
              if (!monthMinValue[month] || totalValue < monthMinValue[month]) {
                monthMinValue[month] = totalValue;
              }
            });

            // 3. แปลงเป็น array ตามโครงสร้างที่ต้องการ
            const result = Object.entries(monthMinValue).map(
              ([month, value]) => ({
                value,
                month,
              }),
            );

            conditions = result;
          }
          const {  ...neTermType } = eTermType
          return { ...neTermType, conditions };
        });
        const { data, ...neArea } = eArea;
        // console.log('********************');
        return { ...neArea, term_type };
      });
      return { ...e, area };
    });
    // dateSum[date].totalValue :
    console.log('calcDatas : ', calcDatas);
    return calcDatas
    // return { calcDatas, calcDataTermType };
  }
}
