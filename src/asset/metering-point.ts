import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  checkStartEndBoom,
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import axios from 'axios';
import {
  findMoveEndDatePoints,
  findMoveStartDatePoints,
  getConflictReason,
  shouldAddOldPointToEndDateArray,
  shouldAddOldPointToStartDateArray,
  shouldBlockNewPeriod,
} from 'src/common/utils/asset.util';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');

@Injectable()
export class AssetMeteringPointService {
  constructor(private prisma: PrismaService) {}

  async nominationPointNonTpaPoint() {
    return [
      {
        id: 1,
        type: 'Nomination Point',
        data: await this.prisma.nomination_point.findMany({
          where: {
            non_tpa_point: {
              none: {},
            },
          },
          include: {
            customer_type: true,
            contract_point: true,
            zone: true,
            area: true,
            entry_exit: true,
            non_tpa_point: true,
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
        }),
      },
      {
        id: 2,
        type: 'Non-TPA Point',
        data: await this.prisma.non_tpa_point.findMany({
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
        }),
      },
      // {
      //   id: 2,
      //   type: 'Non-TPA Point',
      //   data: await this.prisma.nomination_point.findMany({
      //     where:{
      //       non_tpa_point:{
      //         some:{}
      //       }
      //     },
      //     include: {
      //       contract_point: true,
      //       zone: true,
      //       area: true,
      //       entry_exit: true,
      //       non_tpa_point:true,
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
      //   }),
      // },
    ];
  }

  async meteringPoint() {
    return this.prisma.metering_point.findMany({
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
  }

  async meteringPointOnce(id: any) {
    return this.prisma.metering_point.findUnique({
      where: {
        id: Number(id),
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
    });
  }

  async meteringPointCreate(payload: any, userId: any) {
    const {
      point_type_id,
      entry_exit_id,
      customer_type_id,
      non_tpa_point_id,
      nomination_point_id,
      metered_id,
      zone_id,
      area_id,
      start_date,
      end_date,
      ...dataWithout
    } = payload;

    const meteringPoint = await this.meteringPoint();
    let validateList = [];
    const startDate = start_date ? getTodayNowAdd7(start_date).toDate() : null;
    const endDate = end_date ? getTodayNowAdd7(end_date).toDate() : null;

    const activePoint = await this.prisma.metering_point.findMany({
      where: {
        AND: [
          {
            metered_point_name: dataWithout?.metered_point_name,
          },
          {
            OR: [
              // Case 1: Existing point starts before or on new start date and is still active
              {
                AND: [
                  { start_date: { lte: startDate } },
                  {
                    OR: [
                      { end_date: null }, // Indefinite period
                      { end_date: { gt: startDate } }, // Ends after new start date
                    ],
                  },
                ],
              },
              // Case 2: Existing point starts during new period
              {
                AND: [
                  { start_date: { gte: startDate } },
                  ...(endDate ? [{ start_date: { lt: endDate } }] : []),
                ],
              },
            ],
          },
        ],
      },
      include: {
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
    if (activePoint && activePoint.length > 0) {
      validateList = activePoint.map((point) => {
        return `${point.metered_point_name} already exists at ${dayjs(point.start_date).format('DD/MM/YYYY')}`;
      });
    }

    if (validateList.length > 0) {
      const message = validateList.join('<br/>');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: message,
          error: message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const meteringPointCreate = await this.prisma.metering_point.create({
      data: {
        ...dataWithout,
        metered_id: metered_id
          ? metered_id
          : String(
              meteringPoint.length + 1 < 10
                ? `000${meteringPoint.length + 1}`
                : meteringPoint.length + 1 < 100
                  ? `00${meteringPoint.length + 1}`
                  : meteringPoint.length + 1 < 1000
                    ? `0${meteringPoint.length + 1}`
                    : meteringPoint.length + 1,
            ),
        point_type: {
          connect: {
            id: point_type_id || null,
          },
        },
        ...(entry_exit_id !== null && {
          entry_exit: {
            connect: {
              id: entry_exit_id,
            },
          },
        }),
        ...(customer_type_id !== null && {
          customer_type: {
            connect: {
              id: customer_type_id,
            },
          },
        }),
        ...(non_tpa_point_id !== null && {
          non_tpa_point: {
            connect: {
              id: non_tpa_point_id,
            },
          },
        }),
        ...(nomination_point_id !== null && {
          nomination_point: {
            connect: {
              id: nomination_point_id,
            },
          },
        }),
        ...(zone_id !== null && {
          zone: {
            connect: {
              id: zone_id,
            },
          },
        }),
        ...(area_id !== null && {
          area: {
            connect: {
              id: area_id,
            },
          },
        }),
        start_date: start_date ? getTodayStartAdd7(start_date).toDate() : null,
        end_date: end_date ? getTodayStartAdd7(end_date).toDate() : null,
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
        create_by_account: {
          connect: {
            id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
          },
        },
      },
      include:{
        customer_type: true,
      }
    });
    this.updateMeterToWebSerive(meteringPointCreate);
    return meteringPointCreate;
  }

  async meteringPointEdit(payload: any, userId: any, id: any) {
    const {
      point_type_id,
      entry_exit_id,
      customer_type_id,
      non_tpa_point_id,
      nomination_point_id,
      zone_id,
      area_id,
      start_date,
      end_date,
      id: _, // Remove id from dataWithout to prevent Prisma error
      ...dataWithout
    } = payload;

    let validateList = [];
    const startDate = start_date ? getTodayNowAdd7(start_date).toDate() : null;
    const endDate = end_date ? getTodayNowAdd7(end_date).toDate() : null;

    const activePoint = await this.prisma.metering_point.findMany({
      where: {
        AND: [
          { id: { not: Number(id) } },
          { metered_point_name: dataWithout?.metered_point_name },
          {
            OR: [
              // Case 1: Existing point starts before or on new start date and is still active
              {
                AND: [
                  { start_date: { lte: startDate } },
                  {
                    OR: [
                      { end_date: null }, // Indefinite period
                      { end_date: { gt: startDate } }, // Ends after new start date
                    ],
                  },
                ],
              },
              // Case 2: Existing point starts during new period
              {
                AND: [
                  { start_date: { gte: startDate } },
                  ...(endDate ? [{ start_date: { lt: endDate } }] : []),
                ],
              },
            ],
          },
        ],
      },
      include: {
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
    if (activePoint && activePoint.length > 0) {
      validateList = activePoint.map((point) => {
        return `${point.metered_point_name} already exists at ${dayjs(point.start_date).format('DD/MM/YYYY')}`;
      });
    }

    if (validateList.length > 0) {
      const message = validateList.join('<br/>');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: message,
          error: message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const meteringPointUpdate = await this.prisma.metering_point.update({
      where: {
        id: Number(id),
      },
      data: {
        ...dataWithout,
        point_type: {
          connect: {
            id: point_type_id || null,
          },
        },
        ...(entry_exit_id !== null && {
          entry_exit: {
            connect: {
              id: entry_exit_id,
            },
          },
        }),
        ...(customer_type_id !== null && {
          customer_type: {
            connect: {
              id: customer_type_id,
            },
          },
        }),
        ...(non_tpa_point_id !== null && {
          non_tpa_point: {
            connect: {
              id: non_tpa_point_id,
            },
          },
        }),
        ...(nomination_point_id !== null && {
          nomination_point: {
            connect: {
              id: nomination_point_id,
            },
          },
        }),
        ...(zone_id !== null && {
          zone: {
            connect: {
              id: zone_id,
            },
          },
        }),
        ...(area_id !== null && {
          area: {
            connect: {
              id: area_id,
            },
          },
        }),
        start_date: start_date ? getTodayStartAdd7(start_date).toDate() : null,
        end_date: end_date ? getTodayStartAdd7(end_date).toDate() : null,
        update_date: getTodayNowAdd7().toDate(),
        update_by_account: {
          connect: {
            id: Number(userId),
          },
        },
        update_date_num: getTodayNowAdd7().unix(),
      },
      include:{
        customer_type: true,
      }
    });

    this.updateMeterToWebSerive(meteringPointUpdate);
    return meteringPointUpdate;
  }

  private async updateMeteringPointsWithDeduplication(
    points: any[],
    oldPoint: any,
    shouldAddOldPoint: boolean,
    updateData: any,
    webServiceStartDate?: Date,
  ) {
    if (points.length === 0) return;

    if (shouldAddOldPoint) {
      points.push(oldPoint);
    }

    // Remove duplicates based on id
    const uniquePoints = points.filter(
      (point, index, self) =>
        index === self.findIndex((p) => p.id === point.id),
    );

    if (uniquePoints.length > 0) {
      await this.prisma.metering_point.updateMany({
        where: {
          id: { in: uniquePoints.map((item) => item.id) },
        },
        data: updateData,
      });
      // Update web service for metering points
      this.updateMeterToWebSerive(uniquePoints, webServiceStartDate);
    }
  }

  async meteringPointNewPeriod(payload: any, userId: any) {
    const { start_date, end_date, ref_id, ...dataWithout } = payload;

    const oldPoint = await this.meteringPointOnce(ref_id);
    if (!oldPoint) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: 'Metering point did not exists',
          error: 'Please try again later',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate the new period
    const validation = await this.checkMeteringPointNewPeriod({
      name: dataWithout?.metered_point_name,
      start_date: start_date,
      end_date: end_date,
      ref_id,
    });

    if (!validation.isValid) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: validation.validateList.join('<br/>'),
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const startDate = start_date
      ? getTodayStartAdd7(start_date).toDate()
      : null;
    const endDate = end_date ? getTodayStartAdd7(end_date).toDate() : null;

    // Common update data structure
    const updateMetadata = {
      update_by: Number(userId),
      update_date: getTodayNowAdd7().toDate(),
      update_date_num: getTodayNowAdd7().unix(),
    };

    // Find and update points that need end date changes
    const moveEndDatePoints = await findMoveEndDatePoints(
      this.prisma,
      dataWithout?.metered_point_name,
      startDate,
      endDate,
      ref_id,
      'metering_point',
    );

    await this.updateMeteringPointsWithDeduplication(
      moveEndDatePoints,
      oldPoint,
      shouldAddOldPointToEndDateArray(oldPoint, startDate, endDate),
      { ...updateMetadata, end_date: startDate },
    );

    // Find and update points that need start date changes (only if endDate exists)
    if (endDate) {
      const moveStartDatePoints = await findMoveStartDatePoints(
        this.prisma,
        dataWithout?.metered_point_name,
        startDate,
        endDate,
        ref_id,
        'metering_point',
      );

      await this.updateMeteringPointsWithDeduplication(
        moveStartDatePoints,
        oldPoint,
        shouldAddOldPointToStartDateArray(oldPoint, startDate, endDate),
        { ...updateMetadata, start_date: endDate },
        endDate, // Pass endDate for web service
      );
    }

    return await this.meteringPointCreate(payload, userId);
  }

  private async findConflictingMeteringPoints(
    name: string,
    startDate: Date,
    endDate: Date | null,
    ref_id?: number,
  ) {
    const existingPoints = await this.prisma.metering_point.findMany({
      where: {
        metered_point_name: name,
      },
      orderBy: {
        start_date: 'asc',
      },
    });

    if (ref_id) {
      const oldPoint = await this.meteringPointOnce(ref_id);
      if (oldPoint) {
        existingPoints.push(oldPoint);
      }
    }

    const conflicts = [];

    for (const existingPoint of existingPoints) {
      // Only treat as conflict if it should actually block the operation
      if (
        shouldBlockNewPeriod(
          startDate,
          endDate,
          existingPoint.start_date,
          existingPoint.end_date,
        )
      ) {
        conflicts.push({
          ...existingPoint,
          conflictReason: getConflictReason(
            startDate,
            endDate,
            existingPoint.start_date,
            existingPoint.end_date,
          ),
        });
      }
    }

    return conflicts;
  }

  async checkMeteringPointNewPeriod(payload: any) {
    const { name, start_date, end_date, ref_id } = payload;

    // Validate input
    if (!name) {
      return {
        isValid: false,
        validateList: ['Metering point name is required'],
        meteringPoint: [],
      };
    }

    if (!start_date) {
      return {
        isValid: false,
        validateList: ['Start date is required'],
        meteringPoint: [],
      };
    }

    const startDate = getTodayStartAdd7(start_date).toDate();
    const endDate = end_date ? getTodayStartAdd7(end_date).toDate() : null;

    // Validate date logic
    if (endDate && startDate >= endDate) {
      return {
        isValid: false,
        validateList: ['Start date must be before end date'],
        meteringPoint: [],
      };
    }

    // Find all conflicting metering points
    const conflicts = await this.findConflictingMeteringPoints(
      name,
      startDate,
      endDate,
      ref_id,
    );

    // Generate validation messages
    const validateList = conflicts.map(
      (conflict) => `${conflict.metered_point_name} ${conflict.conflictReason}`,
    );

    return {
      isValid: conflicts.length === 0,
      validateList,
      meteringPoint: conflicts,
    };
  }

  async updateMeterToWebSerive(meteringPoint: any, newStartDate?: Date) {
    try {
      // basic safety on service endpoint
      try {
        const u = new URL(String(process.env.METER_WEBSERVICE));
        if (!['http:', 'https:'].includes(u.protocol)) {
          throw new Error('METER_WEBSERVICE must use http/https');
        }
      } catch (e) {
        return { status: false, error: `Invalid METER_WEBSERVICE: ${e?.message || 'unknown'}` };
      }
      if (meteringPoint) {
        const webSeriveAuth = await axios.post(
          `${process.env.METER_WEBSERVICE}/user/login`,
          {
            username: process.env.METER_WEBSERVICE_USERNAME,
            password: process.env.METER_WEBSERVICE_PASSWORD,
          },
        );
        if (webSeriveAuth?.data?.access_token) {
          const webSeriveToken = webSeriveAuth.data.access_token;
          if (meteringPoint.metered_id) {
            const webSeriveUpdate = await this.postToWebSerive({
              webSeriveToken: webSeriveToken,
              pointID: meteringPoint.metered_id,
              customerType: meteringPoint.customer_type.name,
              dateStart: dayjs(
                newStartDate ? newStartDate : meteringPoint.start_date,
              ).tz('Asia/Bangkok').format('YYYY-MM-DD'),
              id: meteringPoint.id,
            });
            return webSeriveUpdate;
          } else if (Array.isArray(meteringPoint)) {
            const webSeriveUpdateMany = await Promise.all(
              meteringPoint.map(async (item) => {
                const webSeriveUpdate = await this.postToWebSerive({
                  webSeriveToken: webSeriveToken,
                  pointID: item.metered_id,
                  customerType: item.customer_type.name,
                  dateStart: dayjs(
                    newStartDate ? newStartDate : item.start_date,
                  ).tz('Asia/Bangkok').format('YYYY-MM-DD'),
                  id: item.id,
                });
                return webSeriveUpdate;
              }),
            );
            return {
              status: true,
              data: webSeriveUpdateMany,
            };
          } else {
            return {
              status: false,
              error: 'Metered point id not found',
            };
          }
        } else {
          return {
            status: false,
            error: 'Web service token not found',
          };
        }
      } else {
        return {
          status: false,
          error: 'Metering point not found',
        };
      }
    } catch (error) {
      return {
        status: false,
        error: error,
      };
    }
  }

  async postToWebSerive(body: {
    webSeriveToken: string;
    pointID: string;
    customerType: string;
    dateStart: string;
    id: number;
  }) {
    try {
      // basic safety on service endpoint
      try {
        const u = new URL(String(process.env.METER_WEBSERVICE));
        if (!['http:', 'https:'].includes(u.protocol)) {
          throw new Error('METER_WEBSERVICE must use http/https');
        }
      } catch (e) {
        return { status: false, error: `Invalid METER_WEBSERVICE: ${e?.message || 'unknown'}` };
      }
      const webSeriveUpdate = await axios.post(
        `${process.env.METER_WEBSERVICE}/meter?token=${body.webSeriveToken}`,
        {
          METER_POINT_ID: body.pointID,
          CUSTOMER_TYPE: body.customerType,
          DATE_START: body.dateStart,
          // "VW_RECORD_QUALITY": null,
          // "VW_BILLINGTRANS": null,
          // "VW_BILLINGTRANS_IND": null,
          // "VW_BILLINGTRANS_TEMP": null,
          // "OPERATION_REPORT": null,
          // "VW_RECORD_ALL_MAPPING_METER": null,
          // "VW_OUTPUT_TPA_INTRADAY": null,
          // "VW_SOURCE_O_OGC_O2": null,
          // "VW_SOURCE_O_OGC_HC": null,
          // "VW_SOURCE_QUALITY_MOISTURE": null,
          // "VW_SOURCE_O_OGC_H2S": null,
          // "VW_SOURCE_O_OGC_HG": null,
          ID: body.id,
        },
      );
      return {
        status: true,
        data: webSeriveUpdate,
      };
    } catch (error) {
      return {
        status: false,
        error: error,
      };
    }
  }
}
