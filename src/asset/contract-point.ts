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
import { AssetNominationPointService } from './nomination-point';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');

@Injectable()
export class AssetContractPointService {
  constructor(
    private prisma: PrismaService,
    private readonly assetNominationPointService: AssetNominationPointService,
  ) {}

  contractPoint() {
    return this.prisma.contract_point.findMany({
      include: {
        area: true,
        zone: true,
        entry_exit: true,
        nomination_point_list: {
          include: {
            contract_point_list: true,
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
        },
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

  contractPointOnce(id: any) {
    return this.prisma.contract_point.findUnique({
      where: {
        id: Number(id),
      },
      include: {
        area: true,
        zone: true,
        entry_exit: true,
        nomination_point_list: {
          include: {
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
        },
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

  async contractPointCreate(payload: any, userId: any, req?: any) {
    const {
      contract_point_start_date,
      contract_point_end_date,
      entry_exit_id,
      zone_id,
      area_id,
      contract_nomination_point,
      nomination_point_start_date,
      nomination_point_end_date,
      ...dataWithout
    } = payload;

    let validateList = [];
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const startDate = contract_point_start_date
      ? getTodayNowAdd7(contract_point_start_date).toDate()
      : null;
    const endDate = contract_point_end_date
      ? getTodayNowAdd7(contract_point_end_date).toDate()
      : null;

    if (dataWithout?.contract_point) {
      const ckName = await this.prisma.contract_point.findFirst({
        where: {
          AND: [
            { contract_point: dataWithout?.contract_point },
            {
              OR: [
                { contract_point_start_date: { lte: startDate || todayStart } }, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                { contract_point_end_date: { lte: startDate || todayStart } },
              ],
            },
            {
              OR: [
                { contract_point_end_date: null }, // ถ้า end_date เป็น null
                { contract_point_end_date: { gt: startDate || todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                { contract_point_end_date: { gt: endDate || todayEnd } },
              ],
            },
          ],
        },
      });
      if (ckName) {
        const message = `This Contract point has already been used.`;
        validateList.push(message);
      }
    }

    const pairedPoint = contract_nomination_point.filter((item) =>
      Number(item?.id),
    );
    const newPairPoint = contract_nomination_point.filter(
      (item) => !item?.id && Number(item?.ref_id),
    );
    if (
      pairedPoint &&
      newPairPoint &&
      pairedPoint.length + newPairPoint.length > 0
    ) {
      try {
        const newNominationPointIDList = pairedPoint.map((item) => item.id);
        const newNominationPointRefIDList = newPairPoint.map(
          (item) => item.ref_id,
        );
        const combinedNominationPointList = [
          ...new Set([
            ...newNominationPointIDList,
            ...newNominationPointRefIDList,
          ]),
        ];

        // #region หา nomination point ที่มี area ไม่ตรงกับ contract point
        const nominationWithDiffArea =
          await this.prisma.nomination_point.findMany({
            where: {
              id: {
                in: combinedNominationPointList,
              },
              area: {
                isNot: {
                  id: area_id,
                },
              },
            },
            include: {
              zone: true,
              area: true,
            },
          });

        if (nominationWithDiffArea.length > 0) {
          const message = `Area is not correct.`;
          validateList.push(message);
        }
        // #endregion

        // #region หาสัญญาที่มีหลาย contract point ที่ใช้ nomination point ร่วมกัน
        const ckNominationPointList = await this.prisma.contract_point.findMany(
          {
            where: {
              AND: [
                {
                  nomination_point_list: {
                    some: {
                      id: { in: combinedNominationPointList },
                    },
                  },
                },
                {
                  OR: [
                    {
                      contract_point_start_date: {
                        lte: startDate || todayStart,
                      },
                    }, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                    {
                      contract_point_end_date: { lte: startDate || todayStart },
                    },
                  ],
                },
                {
                  OR: [
                    { contract_point_end_date: null }, // ถ้า end_date เป็น null
                    {
                      contract_point_end_date: { gt: startDate || todayStart },
                    }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                    { contract_point_end_date: { gt: endDate || todayEnd } },
                  ],
                },
              ],
            },
          },
        );

        if (!!ckNominationPointList && ckNominationPointList.length > 0) {
          const contractIDList = ckNominationPointList.map((item) => item.id);
          const contractCodeWithNomination =
            await this.assetNominationPointService.contractCodeWithNominationPointInContract();
          const contractCodeThatUseMoreThan1ContractPoint =
            contractCodeWithNomination.filter((conntract) => {
              conntract.nominationPointInContract =
                conntract.nominationPointInContract.filter((point: any) =>
                  point.contractPoint.some((contractPoint: any) =>
                    contractIDList.includes(Number(contractPoint.id)),
                  ),
                );
              return conntract.nominationPointInContract.length > 1;
            });
          if (contractCodeThatUseMoreThan1ContractPoint.length > 0) {
            contractCodeThatUseMoreThan1ContractPoint.map((conntract) => {
              const nominationPointInContract =
                conntract.nominationPointInContract.filter((point) => {
                  point.contractPoint = point.contractPoint.filter(
                    (contractPoint: any) =>
                      contractIDList.includes(Number(contractPoint.id)),
                  );
                  return point.contractPoint.length > 0;
                });
              const errorMessage = nominationPointInContract.map((point) => {
                return point.contractPoint.map((contractPoint) => {
                  const sameNominationPoint = point.nominationPoint
                    .filter((nominationPoint) =>
                      combinedNominationPointList.includes(nominationPoint.id),
                    )
                    .map((nominationPoint) => nominationPoint.nomination_point);
                  let currentPointString = '';
                  if (sameNominationPoint.length > 1) {
                    const lastPc = sameNominationPoint.pop();
                    let currentPointString = sameNominationPoint.join(', ');
                    currentPointString += ` and ${lastPc}`;
                  } else {
                    currentPointString = sameNominationPoint.join(', ');
                  }
                  return `Contract ${conntract.contract_code} have used both this point and ${contractPoint.contract_point} that have same ${currentPointString} Nomination Point.`;
                });
              });
              validateList.push(...errorMessage.flat());
            });
          }
        }
        // #endregion
      } catch (error) {
        validateList = validateList;
      }
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
    } else {
      // #region new period
      const newPoints = contract_nomination_point.filter(
        (point) => !point.id && point.ref_id,
      );
      for (const point of newPoints) {
        let refPoint: any;
        if (point.ref_id) {
          // If there's a ref_id, get the reference point
          refPoint = await this.prisma.nomination_point.findUnique({
            where: { id: point.ref_id },
            include: {
              area: true,
              zone: true,
              entry_exit: true,
              customer_type: true,
              contract_point_list: true,
            },
          });
        }

        if (refPoint) {
          const startDate =
            point.start_date || nomination_point_start_date
              ? getTodayNowAdd7(
                  point.start_date || nomination_point_start_date,
                ).toDate()
              : null;
          const endDate =
            point.end_date || nomination_point_end_date
              ? getTodayNowAdd7(
                  point.end_date || nomination_point_end_date,
                ).toDate()
              : null;

          const sameNominationPoint =
            await this.prisma.nomination_point.findFirst({
              where: {
                AND: [
                  {
                    nomination_point: refPoint.nomination_point,
                  },
                  {
                    start_date: {
                      equals: startDate,
                    },
                  },
                  {
                    end_date: {
                      equals: endDate,
                    },
                  },
                ],
              },
              include: {
                area: true,
                zone: true,
                entry_exit: true,
                customer_type: true,
                contract_point_list: true,
              },
            });

          if (sameNominationPoint) {
            pairedPoint.push({ id: sameNominationPoint.id });
          } else {
            try {
              const newNomPoint =
                await this.assetNominationPointService.nominationPointNewPeriod(
                  {
                    ref_id: point.id || point.ref_id,
                    start_date: point.start_date || nomination_point_start_date,
                    end_date: point.end_date || nomination_point_end_date,
                    contract_nomination_point: refPoint.contract_point_list.map(
                      (item) => ({
                        nomination_point_id: null,
                        contract_point_id: item.id,
                      }),
                    ),
                    entry_exit_id: refPoint.entry_exit.id,
                    zone_id: refPoint.zone.id,
                    area_id: refPoint.area.id,
                    customer_type_id: refPoint.customer_type.id,
                    nomination_point: refPoint.nomination_point,
                    description: refPoint.description,
                    maximum_capacity: refPoint.maximum_capacity,
                  },
                  userId,
                  undefined,
                  req,
                );

              if (newNomPoint && newNomPoint.id) {
                pairedPoint.push({ id: newNomPoint.id });
              }
            } catch (error) {
              if (error.response.error) {
                validateList.push(error.response.error);
              } else {
                validateList.push(
                  `Nomination point with ${point.ref_id ? 'ref_id' : 'id'} ${point.ref_id || point.id} new period failed`,
                );
              }
            }
          }
        } else {
          validateList.push(
            `Nomination point with ${point.ref_id ? 'ref_id' : 'id'} ${point.ref_id || point.id} not found`,
          );
        }
      }
      // #endregion

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
    }

    const configMasterPathCreate = await this.prisma.contract_point.create({
      data: {
        ...dataWithout,
        nomination_point_list: {
          connect: pairedPoint,
        },
        entry_exit: {
          connect: {
            id: entry_exit_id || null,
          },
        },
        zone: {
          connect: {
            id: zone_id || null,
          },
        },
        area: {
          connect: {
            id: area_id || null,
          },
        },
        // active: true,
        contract_point_start_date: startDate,
        contract_point_end_date: endDate,
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
        create_by_account: {
          connect: {
            id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
          },
        },
      },
    });
    return configMasterPathCreate;
  }

  async contractPointEdit(payload: any, userId: any, id: any, req?: any) {
    const {
      contract_point_start_date,
      contract_point_end_date,
      entry_exit_id,
      zone_id,
      area_id,
      contract_nomination_point,
      nomination_point_start_date,
      nomination_point_end_date,
      ...dataWithout
    } = payload;

    let validateList = [];
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const startDate = contract_point_start_date
      ? getTodayNowAdd7(contract_point_start_date).toDate()
      : null;
    const endDate = contract_point_end_date
      ? getTodayNowAdd7(contract_point_end_date).toDate()
      : null;

    if (dataWithout?.contract_point) {
      const ckName = await this.prisma.contract_point.findFirst({
        where: {
          AND: [
            { id: { not: Number(id) } },
            { contract_point: dataWithout?.contract_point },
            {
              OR: [
                { contract_point_start_date: { lte: startDate || todayStart } }, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                { contract_point_end_date: { lte: startDate || todayStart } },
              ],
            },
            {
              OR: [
                { contract_point_end_date: null }, // ถ้า end_date เป็น null
                { contract_point_end_date: { gt: startDate || todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                { contract_point_end_date: { gt: endDate || todayEnd } },
              ],
            },
          ],
        },
      });
      if (ckName) {
        const message = `This Contract point has already been used.`;
        validateList.push(message);
      }
    }

    const pairedPoint = contract_nomination_point.filter((item) =>
      Number(item?.id),
    );
    const newPairPoint = contract_nomination_point.filter(
      (item) => !item?.id && Number(item?.ref_id),
    );
    if (
      pairedPoint &&
      newPairPoint &&
      pairedPoint.length + newPairPoint.length > 0
    ) {
      try {
        const newNominationPointIDList = pairedPoint.map((item) => item.id);
        const newNominationPointRefIDList = newPairPoint.map(
          (item) => item.ref_id,
        );
        const combinedNominationPointList = [
          ...new Set([
            ...newNominationPointIDList,
            ...newNominationPointRefIDList,
          ]),
        ];

        // #region หา nomination point ที่มี area ไม่ตรงกับ contract point
        const nominationWithDiffArea =
          await this.prisma.nomination_point.findMany({
            where: {
              id: {
                in: combinedNominationPointList,
              },
              area: {
                isNot: {
                  id: area_id,
                },
              },
            },
            include: {
              zone: true,
              area: true,
            },
          });

        if (nominationWithDiffArea.length > 0) {
          const message = `Area is not correct.`;
          validateList.push(message);
        }
        // #endregion

        // #region หาสัญญาที่มีหลาย contract point ที่ใช้ nomination point ร่วมกัน
        const ckNominationPointList = await this.prisma.contract_point.findMany(
          {
            where: {
              AND: [
                { id: { not: Number(id) } },
                {
                  nomination_point_list: {
                    some: {
                      id: { in: combinedNominationPointList },
                    },
                  },
                },
                {
                  OR: [
                    {
                      contract_point_start_date: {
                        lte: startDate || todayStart,
                      },
                    }, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                    {
                      contract_point_end_date: { lte: startDate || todayStart },
                    },
                  ],
                },
                {
                  OR: [
                    { contract_point_end_date: null }, // ถ้า end_date เป็น null
                    {
                      contract_point_end_date: { gt: startDate || todayStart },
                    }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                    { contract_point_end_date: { gt: endDate || todayEnd } },
                  ],
                },
              ],
            },
          },
        );

        if (!!ckNominationPointList && ckNominationPointList.length > 0) {
          const contractIDList = ckNominationPointList.map((item) => item.id);
          contractIDList.push(Number(id));
          const contractCodeWithNomination =
            await this.assetNominationPointService.contractCodeWithNominationPointInContract();
          const contractCodeThatUseMoreThan1ContractPoint =
            contractCodeWithNomination.filter((conntract) => {
              conntract.nominationPointInContract =
                conntract.nominationPointInContract.filter((point: any) =>
                  point.contractPoint.some((contractPoint: any) =>
                    contractIDList.includes(Number(contractPoint.id)),
                  ),
                );
              return conntract.nominationPointInContract.length > 1;
            });
          if (contractCodeThatUseMoreThan1ContractPoint.length > 0) {
            contractIDList.pop();
            contractCodeThatUseMoreThan1ContractPoint.map((conntract) => {
              const nominationPointInContract =
                conntract.nominationPointInContract.filter((point) => {
                  point.contractPoint = point.contractPoint.filter(
                    (contractPoint: any) =>
                      contractIDList.includes(Number(contractPoint.id)),
                  );
                  return point.contractPoint.length > 0;
                });
              const errorMessage = nominationPointInContract.map((point) => {
                return point.contractPoint.map((contractPoint) => {
                  const sameNominationPoint = point.nominationPoint
                    .filter((nominationPoint) =>
                      combinedNominationPointList.includes(nominationPoint.id),
                    )
                    .map((nominationPoint) => nominationPoint.nomination_point);
                  let currentPointString = '';
                  if (sameNominationPoint.length > 1) {
                    const lastPc = sameNominationPoint.pop();
                    let currentPointString = sameNominationPoint.join(', ');
                    currentPointString += ` and ${lastPc}`;
                  } else {
                    currentPointString = sameNominationPoint.join(', ');
                  }
                  return `Contract ${conntract.contract_code} have used both this point and ${contractPoint.contract_point} that have same ${currentPointString} Nomination Point.`;
                });
              });
              validateList.push(...errorMessage.flat());
            });
          }
        }
        // #endregion
      } catch (error) {
        validateList = validateList;
      }
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
    } else {
      const original = await this.contractPointOnce(id);

      if (original && original.id) {
        // Get existing nomination points from original
        const originalPointIDList = original.nomination_point_list.map(
          (point) => point.id,
        );

        // Separate points into existing and new ones
        const existingPoints = contract_nomination_point.filter(
          (point) => point.id && originalPointIDList.includes(point.id),
        );

        const newPoints = contract_nomination_point.filter(
          (point) =>
            (!point.id && point.ref_id) ||
            (point.id && !originalPointIDList.includes(point.id)),
        );

        await this.prisma.$transaction(async (tx) => {
          // Handle existing points
          for (const point of existingPoints) {
            const nominationPoint = await tx.nomination_point.findUnique({
              where: { id: point.id },
              include: {
                area: true,
                zone: true,
                entry_exit: true,
                customer_type: true,
                contract_point_list: true,
              },
            });

            const newStartDate = getTodayNowAdd7(point.start_date);
            const newEndDate = getTodayNowAdd7(point.end_date);
            const oldStartDate = getTodayNowAdd7(nominationPoint.start_date);
            const oldEndDate = getTodayNowAdd7(nominationPoint.end_date);
            if (
              !newStartDate.isSame(oldStartDate) ||
              !(
                newEndDate.isSame(oldEndDate) ||
                (!newEndDate.isValid() && !oldEndDate.isValid())
              )
            ) {
              await this.assetNominationPointService.nominationPointEdit(
                {
                  start_date: point.start_date,
                  end_date: point.end_date,
                  nomination_point: nominationPoint.nomination_point,
                  description: nominationPoint.description,
                  maximum_capacity: nominationPoint.maximum_capacity,
                  entry_exit_id: nominationPoint.entry_exit_id,
                  zone_id: nominationPoint.zone_id,
                  area_id: nominationPoint.area_id,
                  customer_type_id: nominationPoint.customer_type_id,
                  contract_nomination_point:
                    nominationPoint.contract_point_list.map((item) => ({
                      // nomination_point_id: point.id,
                      contract_point_id: item.id,
                    })),
                },
                userId,
                point.id,
                tx,
              );
            }
          }

          // Handle new points
          for (const point of newPoints) {
            let refPoint: any;
            if (point.ref_id) {
              // If there's a ref_id, get the reference point
              refPoint = await tx.nomination_point.findUnique({
                where: { id: point.ref_id },
                include: {
                  area: true,
                  zone: true,
                  entry_exit: true,
                  customer_type: true,
                  contract_point_list: true,
                },
              });
            } else if (point.id) {
              // If there's an id but not in original list, get that point
              refPoint = await tx.nomination_point.findUnique({
                where: { id: point.id },
                include: {
                  area: true,
                  zone: true,
                  entry_exit: true,
                  customer_type: true,
                  contract_point_list: true,
                },
              });
            }

            if (refPoint) {
              const startDate =
                point.start_date || nomination_point_start_date
                  ? getTodayNowAdd7(
                      point.start_date || nomination_point_start_date,
                    ).toDate()
                  : null;
              const endDate =
                point.end_date || nomination_point_end_date
                  ? getTodayNowAdd7(
                      point.end_date || nomination_point_end_date,
                    ).toDate()
                  : null;

              const sameNominationPoint = await tx.nomination_point.findFirst({
                where: {
                  AND: [
                    {
                      nomination_point: refPoint.nomination_point,
                    },
                    {
                      start_date: {
                        equals: startDate,
                      },
                    },
                    {
                      end_date: {
                        equals: endDate,
                      },
                    },
                  ],
                },
                include: {
                  area: true,
                  zone: true,
                  entry_exit: true,
                  customer_type: true,
                  contract_point_list: true,
                },
              });

              if (sameNominationPoint) {
                pairedPoint.push({ id: sameNominationPoint.id });
              } else {
                const newNomPoint =
                  await this.assetNominationPointService.nominationPointNewPeriod(
                    {
                      ref_id: point.id || point.ref_id,
                      start_date:
                        point.start_date || nomination_point_start_date,
                      end_date: point.end_date || nomination_point_end_date,
                      contract_nomination_point:
                        refPoint.contract_point_list.map((item) => ({
                          nomination_point_id: null,
                          contract_point_id: item.id,
                        })),
                      entry_exit_id: refPoint.entry_exit.id,
                      zone_id: refPoint.zone.id,
                      area_id: refPoint.area.id,
                      customer_type_id: refPoint.customer_type.id,
                      nomination_point: refPoint.nomination_point,
                      description: refPoint.description,
                      maximum_capacity: refPoint.maximum_capacity,
                    },
                    userId,
                    tx,
                    req,
                  );

                if (newNomPoint && newNomPoint.id) {
                  pairedPoint.push({ id: newNomPoint.id });
                }
              }
            } else {
              validateList.push(
                `Nomination point with ${point.ref_id ? 'ref_id' : 'id'} ${point.ref_id || point.id} not found`,
              );
            }
          }
        });
      } else {
        const message = `This Contract point data not found.`;
        validateList.push(message);
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
    }

    const configMasterPathEdit = await this.prisma.contract_point.update({
      where: {
        id: Number(id),
      },
      data: {
        ...dataWithout,
        nomination_point_list: {
          set: pairedPoint.map((item: any) => {
            return {
              id: Number(item.id),
            };
          }),
        },
        entry_exit: {
          connect: {
            id: entry_exit_id || null,
          },
        },
        zone: {
          connect: {
            id: zone_id || null,
          },
        },
        area: {
          connect: {
            id: area_id || null,
          },
        },
        // active: true,
        contract_point_start_date: startDate,
        contract_point_end_date: endDate,
        update_by_account: {
          connect: {
            id: Number(userId),
          },
        },
        update_date: getTodayNowAdd7().toDate(),
        update_date_num: getTodayNowAdd7().unix(),
      },
    });

    return configMasterPathEdit;
  }
}
