import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import {
  checkStartEndBoom,
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowYYYYMMDDDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import axios from 'axios';
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');

@Injectable()
export class ParameterNominationDeadlineService {
  constructor(
    private prisma: PrismaService,
  ) {}

  nominationType() {
    return this.prisma.nomination_type.findMany({
      orderBy: {
        id: 'asc',
      },
    });
  }

  processtype() {
    return this.prisma.process_type.findMany({
      orderBy: {
        id: 'asc',
      },
    });
  }

  nominationDeadline() {
    return this.prisma.new_nomination_deadline.findMany({
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
  }

  nominationDeadlineOnce(id: any) {
    return this.prisma.new_nomination_deadline.findUnique({
      where: {
        id: Number(id),
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
    });
  }

  async validateProcessTypeInOrder(
    {
      user_type_id,
      nomination_type_id,
      process_type_id,
      start_date,
      end_date
    } :
    {
      user_type_id: number,
      nomination_type_id: number,
      process_type_id: number,
      start_date: any, // YYYY-MM-DD
      end_date: any
    }
  ) {

    if(process_type_id > 1){
      const parentProcessTypeID = process_type_id - 1;
      const startDate = getTodayNowYYYYMMDDDfaultAdd7(start_date)
      const parentNominationDeadline = await this.prisma.new_nomination_deadline.findMany({
        where: {
          user_type_id: user_type_id,
          nomination_type_id: nomination_type_id,
          process_type_id: parentProcessTypeID,
          start_date: {
            lte: startDate.toDate()
          },
          OR: [
            {
              end_date: null
            },
            {
              end_date: {
                gt: startDate.toDate()
              }
            }
          ]
        },
      })

      // console.log('parentNominationDeadline : ', parentNominationDeadline);

      if(parentNominationDeadline.length > 0){
        return {
          isValid: true,
          message: 'Process Type In Order.'
        }
      }
      else{
        const parentProcessType = await this.prisma.process_type.findUnique({
          where: {
            id: parentProcessTypeID,
          },
        })
        return {
          isValid: false,
          message: `Please add ${parentProcessType?.name || ''} that active before ${startDate.tz('Asia/Bangkok').format('DD/MM/YYYY')} before doing this again.`
        }
      }
    }
    else{
      return {
        isValid: true,
        message: 'Process Type In Order.'
      }
    }
  }

  async nominationDeadlineCreate(payload: any, userId: any) {
    const {
      user_type_id,
      nomination_type_id,
      process_type_id,
      start_date,
      end_date,
      ...dataWithout
    } = payload;

    
    // เจอ overlap ทั้งๆที่วันที่ไม่ทับกัน เลยเปลี่ยนมาใช้ where date แทน checkStartEndBoom ก่อนเพราะรีบเอาขึ้นไป FAT
    // เพราะ checkStartEndBoom เป็นฟังก์ชันกลางถ้าแก้ต้องไปทดสอบหลายที่ซึ่งใช้เวลานาน
    // มีใช้ where แทนเหมือนกันใน checkingConditionCreate กับ checkingConditionEdit
    const startDate = getTodayNowYYYYMMDDDfaultAdd7(start_date).toDate() // YYYY-MM-DD
    const endDate = end_date ? getTodayNowYYYYMMDDDfaultAdd7(end_date).toDate() : null; // YYYY-MM-DD
    const checkSE = await this.prisma.new_nomination_deadline.count({
      where: {
        user_type_id: user_type_id,
        nomination_type_id: nomination_type_id,
        process_type_id: process_type_id,
        OR: [
          {
            AND: [
              {
                start_date: {
                  lte: startDate
                },
              },
              {
                OR: [
                  {
                    end_date: null
                  },
                  {
                    end_date: {
                      gt: startDate
                    }
                  }
                ]
              },
            ]
          },
          {
            AND: [
              {
                start_date: {
                  gte: startDate
                }
              },
              ...(
                endDate ? [
                  {
                    start_date: {
                      lt: endDate
                    }
                  }
                ]
                :
                []
              )
            ]
          }
        ]
      },
    });
    const flagSE = checkSE > 0;

    // let flagSE = false;

    // if (checkSE.length > 0) {
    //   for (let i = 0; i < checkSE.length; i++) {
    //     const isOverlap = await checkStartEndBoom(
    //       checkSE[i]?.start_date,
    //       checkSE[i]?.end_date,
    //       start_date,
    //       end_date,
    //     );
    //     if (isOverlap) {
    //       flagSE = true;
    //       break;
    //     }
    //   }
    // } else {
    //   flagSE = false;
    // }

    if (flagSE) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Start Date and End Date should not overlap.',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {
      const validateProcessTypeInOrder = await this.validateProcessTypeInOrder({
        user_type_id: user_type_id,
        nomination_type_id: nomination_type_id,
        process_type_id: process_type_id,
        start_date: start_date,
        end_date: end_date,
      })

      if(!validateProcessTypeInOrder.isValid){
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: validateProcessTypeInOrder.message,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      const nominationDeadlineCreate =
        await this.prisma.new_nomination_deadline.create({
          data: {
            ...dataWithout,
            ...(user_type_id !== null && {
              user_type: {
                connect: {
                  id: user_type_id,
                },
              },
            }),
            ...(nomination_type_id !== null && {
              nomination_type: {
                connect: {
                  id: nomination_type_id,
                },
              },
            }),
            ...(process_type_id !== null && {
              process_type: {
                connect: {
                  id: process_type_id,
                },
              },
            }),
            // active: true,
            start_date: start_date
              ? getTodayNowAdd7(start_date).toDate()
              : null,
            end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });
      return nominationDeadlineCreate;
    }
  }

  async nominationDeadlineEdit(payload: any, userId: any, id: any) {
    const {
      user_type_id,
      nomination_type_id,
      process_type_id,
      start_date,
      end_date,
      ...dataWithout
    } = payload;

    // เจอ overlap ทั้งๆที่วันที่ไม่ทับกัน เลยเปลี่ยนมาใช้ where date แทน checkStartEndBoom ก่อนเพราะรีบเอาขึ้นไป FAT
    // เพราะ checkStartEndBoom เป็นฟังก์ชันกลางถ้าแก้ต้องไปทดสอบหลายที่ซึ่งใช้เวลานาน
    // มีใช้ where แทนเหมือนกันใน checkingConditionCreate กับ checkingConditionEdit
    const startDate = getTodayNowYYYYMMDDDfaultAdd7(start_date).toDate() // YYYY-MM-DD
    const endDate = end_date ? getTodayNowYYYYMMDDDfaultAdd7(end_date).toDate() : null; // YYYY-MM-DD
    const checkSE = await this.prisma.new_nomination_deadline.count({
      where: {
        id: {
          not: Number(id),
        },
        user_type_id: user_type_id,
        nomination_type_id: nomination_type_id,
        process_type_id: process_type_id,
        OR: [
          {
            AND: [
              {
                start_date: {
                  lte: startDate
                },
              },
              {
                OR: [
                  {
                    end_date: null
                  },
                  {
                    end_date: {
                      gt: startDate
                    }
                  }
                ]
              },
            ]
          },
          {
            AND: [
              {
                start_date: {
                  gte: startDate
                }
              },
              ...(
                endDate ? [
                  {
                    start_date: {
                      lt: endDate
                    }
                  }
                ]
                :
                []
              )
            ]
          }
        ]
      },
    });
    const flagSE = checkSE > 0;

    // let flagSE = false;

    // if (checkSE.length > 0) {
    //   for (let i = 0; i < checkSE.length; i++) {
    //     const isOverlap = await checkStartEndBoom(
    //       checkSE[i]?.start_date,
    //       checkSE[i]?.end_date,
    //       start_date,
    //       end_date,
    //     );
    //     if (isOverlap) {
    //       flagSE = true;
    //       break;
    //     }
    //   }
    // } else {
    //   flagSE = false;
    // }

    if (flagSE) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Start Date and End Date should not overlap.',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {

      const validateProcessTypeInOrder = await this.validateProcessTypeInOrder({
        user_type_id: user_type_id,
        nomination_type_id: nomination_type_id,
        process_type_id: process_type_id,
        start_date: start_date,
        end_date: end_date,
      })

      if(!validateProcessTypeInOrder.isValid){
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: validateProcessTypeInOrder.message,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const nominationDeadlineEdit =
        await this.prisma.new_nomination_deadline.update({
          where: {
            id: Number(id),
          },
          data: {
            ...dataWithout,
            ...(user_type_id !== null && {
              user_type: {
                connect: {
                  id: user_type_id,
                },
              },
            }),
            ...(nomination_type_id !== null && {
              nomination_type: {
                connect: {
                  id: nomination_type_id,
                },
              },
            }),
            ...(process_type_id !== null && {
              process_type: {
                connect: {
                  id: process_type_id,
                },
              },
            }),
            // active: true,
            start_date: start_date
              ? getTodayNowAdd7(start_date).toDate()
              : null,
            end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
            update_date: getTodayNowAdd7().toDate(),
            update_by_account: {
              connect: {
                id: Number(userId),
              },
            },
            update_date_num: getTodayNowAdd7().unix(),
          },
        });
      return nominationDeadlineEdit;
    }
  }

}
