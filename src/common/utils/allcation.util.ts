import { PrismaService } from "prisma/prisma.service";
import { getTodayStartAdd7, getTodayNowYYYYMMDDDfaultAdd7, getWeekRange } from "./date.util";
import { area, concept_point, contract_code, group, metering_point, nomination_point, non_tpa_point, Prisma, query_shipper_nomination_file, zone } from "@prisma/client";
import { includes } from "lodash";


const queryShipperNominationFilePopulate = {
  include: {
    nomination_type: true,
    contract_code: {
      select: {
        contract_code: true,
      },
    },
    query_shipper_nomination_status: {
      select: {
        name: true,
      },
    },
  }
}
const nominationPointPopulate = {
  include: {
    area: {
      select: {
        name: true,
      },
    },
    zone: {
      select: {
        name: true,
      },
    },
    contract_point_list: {
      select: {
        contract_point: true,
      },
    },
    entry_exit: true,
    metering_point: true
  }
}
const conceptPointPopulate = {
  include: {
    type_concept_point: true,
  }
}
const nonTpaPointPopulate = {
  include: {
    area: {
      select: {
        name: true,
      },
    },
    nomination_point: {
      include: {
        area: {
          select: {
            name: true,
          },
        },
        zone: {
          select: {
            name: true,
          },
        },
      },
    },
    metering_point: true
  }
}
const meteringPointPopulate = {
  include: {
    area: {
      select: {
        id: true,
        name: true,
      },
    },
    zone: {
      select: {
        id: true,
        name: true,
      },
    },
    nomination_point: {
      include: {
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
        entry_exit: {
          select: {
            id: true,
            name: true,
          },
        },
        area: {
          select: {
            id: true,
            name: true,
          },
        },
        contract_point_list: {
          include: {
            shipper_contract_point: true
          }
        },
        customer_type: true,
      },
    },
    non_tpa_point: {
      include: {
        nomination_point: {
          include: {
            contract_point_list: {
              include: {
                shipper_contract_point: true
              }
            },
            customer_type: true,
          }
        }
      }
    }
  }
}
type queryShipperNominationFileWithRelations = Prisma.query_shipper_nomination_fileGetPayload<typeof queryShipperNominationFilePopulate>
type nominationPointWithRelations = Prisma.nomination_pointGetPayload<typeof nominationPointPopulate>
type conceptPointWithRelations = Prisma.concept_pointGetPayload<typeof conceptPointPopulate>
type nonTpaPointWithRelations = Prisma.non_tpa_pointGetPayload<typeof nonTpaPointPopulate>
type meteringPointWithRelations = Prisma.metering_pointGetPayload<typeof meteringPointPopulate>

export function isMatch(a: string, b: string) {
  return a?.trim()?.toUpperCase() === b?.trim()?.toUpperCase();
}

export function hasValue(val: string) {
  return val && val.trim() !== '';
}

export function validateField(
  itemValue: string,
  pointValue: string,
  activeList: any[],
  activeKey: string,
) {
  return (
    !hasValue(itemValue) ||
    (isMatch(pointValue, itemValue) &&
      activeList?.some((item) => isMatch(item[activeKey], itemValue)))
  );
}

/**
 * Extracts unique gas_day values from evidenApi and generates complete date array
 */
export function extractAndGenerateDateArray(
  evidenApi: any[]
): string[] {
  const dateArray: string[] = [];

  if (evidenApi && evidenApi.length > 0) {
    // Extract all unique gas_day values and convert to dayjs objects for proper date comparison
    const gasDays = [...new Set(evidenApi.map((item: any) => item.gas_day))];

    if (gasDays.length > 0) {
      // Convert to dayjs objects for proper date comparison
      const gasDayObjects = gasDays.map((date) => getTodayStartAdd7(date));

      // Find min and max gas_day using dayjs comparison
      const minGasDayObj = gasDayObjects.reduce((min, current) =>
        current.isBefore(min) ? current : min,
      );
      const maxGasDayObj = gasDayObjects.reduce((max, current) =>
        current.isAfter(max) ? current : max,
      );

      if (minGasDayObj.isValid() && maxGasDayObj.isValid()) {
        let current = minGasDayObj;

        while (current.isSameOrBefore(maxGasDayObj)) {
          dateArray.push(current.format('YYYY-MM-DD'));
          current = current.add(1, 'day');
        }
      }
    }
  }

  return dateArray;
}

/**
 * Builds activeData for each date by querying all necessary tables
 */
export async function buildActiveDataForDates(
  dateArray: string[],
  prisma: PrismaService
): Promise<{
  date: string;
  activeAreas?: area[]
  activeZones?: zone[]
  activeGroups?: group[]
  activeNominationFiles?: queryShipperNominationFileWithRelations[]
  activeContractCodes?: contract_code[]
  activeNominationPoints?: nominationPointWithRelations[]
  activeConceptPoints?: conceptPointWithRelations[]
  activeNonTpaPoints?: nonTpaPointWithRelations[]
  activeMeteringPoints?: meteringPointWithRelations[]
}[]> {
  if(dateArray.length === 0) {
    return [];
  }
  // Find min and max dates from dateArray
  const min = dateArray.reduce((min, current) => {
    const minDayjs = getTodayNowYYYYMMDDDfaultAdd7(min + 'T00:00:00Z')
    const currentDayjs = getTodayNowYYYYMMDDDfaultAdd7(current + 'T00:00:00Z')
    return currentDayjs.isBefore(minDayjs) ? current : min
  });
  const max = dateArray.reduce((max, current) =>{
    const maxDayjs = getTodayNowYYYYMMDDDfaultAdd7(max + 'T00:00:00Z')
    const currentDayjs = getTodayNowYYYYMMDDDfaultAdd7(current + 'T00:00:00Z')
    return currentDayjs.isAfter(maxDayjs) ? current : max
  });

  const minDate = getTodayNowYYYYMMDDDfaultAdd7(
    min + 'T00:00:00Z',
  ).toDate();

  const maxDate = getTodayNowYYYYMMDDDfaultAdd7(
    max + 'T00:00:00Z',
  ).toDate();

  const areaMaster: area[] = await prisma.area.findMany({
    where: {
      OR: [
        { end_date: null }, // No end date means still active
        { end_date: { gt: minDate } }, // End date is after target date
      ],
      start_date: { lte: maxDate }, // Start date is before or on target date
    },
  });

  const zoneMaster: zone[] = await prisma.zone.findMany({
    where: {
      OR: [{ end_date: null }, { end_date: { gt: minDate } }],
      start_date: { lte: maxDate },
    },
  });

  const groupMaster: group[] = await prisma.group.findMany({
    where: {
      user_type_id: 3,
      OR: [{ end_date: null }, { end_date: { gt: minDate } }],
      start_date: { lte: maxDate },
    },
  });

  const contractCodsMaster: contract_code[] = await prisma.contract_code.findMany({
    where: {
      AND: [
        { contract_start_date: { lte: maxDate } }, // Started before or on target date
        // Not rejected
        {
          status_capacity_request_management: {
            NOT: {
              name: {
                equals: 'Rejected',
                mode: 'insensitive',
              },
            },
          },
        },
        // If terminate_date exists and targetDate >= terminate_date, exclude (inactive)
        {
          OR: [
            { terminate_date: null }, // No terminate date
            { terminate_date: { gt: minDate } }, // Terminate date is after target date
          ],
        },
        // Use extend_deadline if available, otherwise use contract_end_date
        {
          OR: [
            // If extend_deadline exists, use it as end date
            {
              AND: [
                { extend_deadline: { not: null } },
                { extend_deadline: { gt: minDate } },
              ],
            },
            // If extend_deadline is null, use contract_end_date
            {
              AND: [
                { extend_deadline: null },
                {
                  OR: [
                    { contract_end_date: null },
                    { contract_end_date: { gt: minDate } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });

  const nominationPointMaster: nominationPointWithRelations[] = await prisma.nomination_point.findMany({
    where: {
      OR: [{ end_date: null }, { end_date: { gt: minDate } }],
      start_date: { lte: maxDate },
    },
    ...nominationPointPopulate,
  });

  const conceptPointMaster: conceptPointWithRelations[] = await prisma.concept_point.findMany({
    where: {
      OR: [{ end_date: null }, { end_date: { gt: minDate } }],
      start_date: { lte: maxDate },
    },
    ...conceptPointPopulate
  });

  const nonTpaPointMaster: nonTpaPointWithRelations[] = await prisma.non_tpa_point.findMany({
    where: {
      OR: [{ end_date: null }, { end_date: { gt: minDate } }],
      start_date: { lte: maxDate },
    },
    ...nonTpaPointPopulate,
  });

  const meteringPointMaster: meteringPointWithRelations[] = await prisma.metering_point.findMany({
    where: {
      OR: [{ end_date: null }, { end_date: { gt: minDate } }],
      start_date: { lte: maxDate },
    },
    ...meteringPointPopulate,
  });

  return await Promise.all(
    dateArray.map(async (date) => {
      try {
        const targetDate = getTodayNowYYYYMMDDDfaultAdd7(
          date + 'T00:00:00Z',
        ).toDate();

        // Find active areas at this date
        const activeAreas: area[] = areaMaster.filter((area) => area.start_date <= targetDate && (area.end_date === null || area.end_date >= targetDate))

        // Find active zones at this date
        const activeZones: zone[] = zoneMaster.filter((zone) => zone.start_date <= targetDate && (zone.end_date === null || zone.end_date >= targetDate))
        

        // Find active groups at this date
        const activeGroups: group[] = groupMaster.filter((group) => group.start_date <= targetDate && (group.end_date === null || group.end_date >= targetDate))

        const { weekStart: targetWeekStart, weekEnd: targetWeekEnd } =
          getWeekRange(targetDate);

        const activeNominationFiles: queryShipperNominationFileWithRelations[] =
          await prisma.query_shipper_nomination_file.findMany({
            where: {
              AND: [
                // Not rejected ot cancelled
                {
                  query_shipper_nomination_status: {
                    id: {
                      notIn: [3, 5]
                    },
                  },
                },
                {
                  OR: [{ del_flag: false }, { del_flag: null }],
                },
                {
                  OR: [
                    // Daily nominations: exact date match
                    {
                      nomination_type: {
                        id: 1,
                      },
                      gas_day: targetDate,
                    },
                    // Weekly nominations: same week
                    {
                      nomination_type: {
                        id: 2,
                      },
                      gas_day: {
                        gte: targetWeekStart,
                        lte: targetWeekEnd,
                      },
                    },
                  ],
                },
              ],
            },
            ...queryShipperNominationFilePopulate,
          });

        // Find active contract_code at this date
        const activeContractCodes: contract_code[] = contractCodsMaster.filter((contractCode) => 
          contractCode.contract_start_date <= targetDate && 
          (contractCode.terminate_date === null || contractCode.terminate_date >= targetDate) &&
          (
            (contractCode.extend_deadline != null && contractCode.extend_deadline >= targetDate) || 
            (contractCode.extend_deadline == null && (contractCode.contract_end_date == null || contractCode.contract_end_date >= targetDate))
          )
        )

        // Find active nomination_point at this date
        const activeNominationPoints: nominationPointWithRelations[] = nominationPointMaster.filter((nominationPoint) => nominationPoint.start_date <= targetDate && (nominationPoint.end_date === null || nominationPoint.end_date >= targetDate))

        // Find active concept_point at this date
        const activeConceptPoints: conceptPointWithRelations[] = conceptPointMaster

        // Find active non_tpa_point at this date
        const activeNonTpaPoints: nonTpaPointWithRelations[] = nonTpaPointMaster.filter((nonTpaPoint) => nonTpaPoint.start_date <= targetDate && (nonTpaPoint.end_date === null || nonTpaPoint.end_date >= targetDate))

        // Find active metering_point at this date
        const activeMeteringPoints: meteringPointWithRelations[] = meteringPointMaster.filter((meteringPoint) => meteringPoint.start_date <= targetDate && (meteringPoint.end_date === null || meteringPoint.end_date >= targetDate))

        return {
          date,
          activeAreas,
          activeZones,
          activeGroups,
          activeNominationFiles,
          activeContractCodes,
          activeNominationPoints,
          activeConceptPoints,
          activeNonTpaPoints,
          activeMeteringPoints,
        };
      } catch (error) {
        // console.error(`Error finding active records for ${date}:`, error);
        return {
          date,
        };
      }
    }),
  );
}

/**
 * Validates contract and shipper existence in active records
 */
export function validateContractAndShipper(
  dFm: any,
  activeDataForDate: any,
): { isValid: boolean; shipperObj?: any } {
  if (!activeDataForDate) {
    return { isValid: false };
  }

  const contractExistsInNominationFiles =
    activeDataForDate.activeNominationFiles?.some((nom: any) =>
      isMatch(nom.contract_code?.contract_code, dFm.contract),
    ) || false;

  const contractExistsInContractCodes =
    activeDataForDate.activeContractCodes?.some((contract: any) =>
      isMatch(contract.contract_code, dFm.contract),
    ) || false;

  // Find the actual shipper group object
  const foundShipperGroup = activeDataForDate.activeGroups?.find((group: any) =>
    isMatch(group.id_name, dFm.shipper),
  );

  // Skip this contract/shipper combination if either doesn't exist in active records
  if (
    !contractExistsInNominationFiles ||
    !contractExistsInContractCodes ||
    !foundShipperGroup
  ) {
    return { isValid: false };
  }

  return { isValid: true, shipperObj: foundShipperGroup };
}

/**
 * Validates NOM point type and attaches area/zone objects
 */
export function validateNomPoint(dFm2: any, activeDataForDate: any): boolean {
  // Find nomination point
  const nominationPoint = activeDataForDate?.activeNominationPoints?.find(
    (nomPoint: any) => isMatch(nomPoint.nomination_point, dFm2.point),
  );
  if (!nominationPoint) return false;

  // Find and validate area
  if (hasValue(dFm2.area)) {
    if (!isMatch(nominationPoint.area?.name, dFm2.area)) return false;
    const foundArea = activeDataForDate?.activeAreas?.find((activeArea: any) =>
      isMatch(activeArea.name, dFm2.area),
    );
    if (!foundArea) return false;
    dFm2.area_obj = foundArea;
  }

  // Find and validate zone
  if (hasValue(dFm2.zone)) {
    if (!isMatch(nominationPoint.zone?.name, dFm2.zone)) return false;
    const foundZone = activeDataForDate?.activeZones?.find((activeZone: any) =>
      isMatch(activeZone.name, dFm2.zone),
    );
    if (!foundZone) return false;
    dFm2.zone_obj = foundZone;
  }

  return true;
  // // Validate area and zone, and relation_point
  // return validateField(dFm2.area, nonTpaPoint.area?.name, activeDataForDate?.activeAreas, 'name') &&
  // validateField(dFm2.zone, nonTpaPoint.zone?.name, activeDataForDate?.activeZones, 'name')
  // // && (!hasValue(dFm2.relation_point_type) ||
  // // (isMatch(dFm2.relation_point_type, 'NOM') &&
  // //  activeDataForDate?.activeNominationPoints?.some((np: any) => isMatch(np.nomination_point, dFm2.relation_point))));
}

/**
 * Validates NONTPA point type and attaches area/zone objects
 */
export function validateNonTpaPoint(
  dFm2: any,
  activeDataForDate: any,
): boolean {
  // Find non TPA point
  const nonTpaPoint = activeDataForDate?.activeNonTpaPoints?.find(
    (ntpPoint: any) => isMatch(ntpPoint.non_tpa_point_name, dFm2.point),
  );
  if (!nonTpaPoint) return false;

  // Find and validate area
  if (hasValue(dFm2.area)) {
    if (!isMatch(nonTpaPoint.area?.name, dFm2.area)) return false;
    const foundArea = activeDataForDate?.activeAreas?.find((activeArea: any) =>
      isMatch(activeArea.name, dFm2.area),
    );
    if (!foundArea) return false;
    dFm2.area_obj = foundArea;
  }

  // Find and validate zone
  if (hasValue(dFm2.zone)) {
    if (!isMatch(nonTpaPoint.zone?.name, dFm2.zone)) return false;
    const foundZone = activeDataForDate?.activeZones?.find((activeZone: any) =>
      isMatch(activeZone.name, dFm2.zone),
    );
    if (!foundZone) return false;
    dFm2.zone_obj = foundZone;
  }

  return true;
  // // Validate area and zone, and relation_point
  // return validateField(dFm2.area, nonTpaPoint.area?.name, activeDataForDate?.activeAreas, 'name') &&
  // validateField(dFm2.zone, nonTpaPoint.zone?.name, activeDataForDate?.activeZones, 'name')
  // // && (!hasValue(dFm2.relation_point_type) ||
  // // (isMatch(dFm2.relation_point_type, 'NOM') &&
  // //   activeDataForDate?.activeNominationPoints?.some((np: any) => isMatch(np.nomination_point, dFm2.relation_point))));
}

/**
 * Validates CONCEPT point type
 */
export function validateConceptPoint(
  dFm2: any,
  activeDataForDate: any,
): boolean {
  // Find concept point
  const conceptPoint = activeDataForDate?.activeConceptPoints?.find(
    (cpPoint: any) => isMatch(cpPoint.concept_point, dFm2.point),
  );
  return !!conceptPoint;
  // if (!conceptPoint) return false;

  // // Validate zone
  // return validateField(dFm2.zone, conceptPoint.zone?.name, activeDataForDate?.activeZones, 'name');
}

/**
 * Validates point based on point_type and attaches area/zone objects
 */
export function validatePointByType(
  dFm2: any,
  activeDataForDate: any,
): boolean {
  if (!activeDataForDate) return true;

  switch (dFm2.point_type?.trim()?.toUpperCase()) {
    case 'NOM':
      return validateNomPoint(dFm2, activeDataForDate);
    case 'NONTPA':
      return validateNonTpaPoint(dFm2, activeDataForDate);
    case 'CONCEPT':
      return validateConceptPoint(dFm2, activeDataForDate);
    default:
      return true;
  }
}

/**
 * Helper method to group data by specific fields
 */
export function groupDataByFields(data: any[], fields: string[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};

  data.forEach(item => {
    // Create a unique key from the specified fields
    const key = fields.map(field => item[field] || '').join('|');

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  });

  return grouped;
}

export function transformToShipperReportStructure(filteredData: any[], getDataLogic?: any, activeData?: any): any[] {
  // Group by gas_day
  const groupedByGasDay = filteredData.reduce((acc, item) => {
    const gasDay = item.gas_day;
    if (!acc[gasDay]) {
      acc[gasDay] = [];
    }
    acc[gasDay].push(item);
    return acc;
  }, {});

  // Transform each gas_day group
  const result = Object.entries(groupedByGasDay).map(([gasDay, items]: [string, any[]]) => {
    // Group by point
    const groupedByPoint = items.reduce((acc, item) => {
      const point = item.point;
      if (!acc[point]) {
        acc[point] = [];
      }
      acc[point].push(item);
      return acc;
    }, {});

    // Transform each point group
    const nomPoint = Object.entries(groupedByPoint).map(([point, pointItems]: [string, any[]]) => {
      // Group by shipper to aggregate allocated values
      const groupedByShipper = pointItems.reduce((acc, item) => {
        // Find allocatedValue from the values array
        const allocatedValueObj = item.values?.find((v: any) => v.tag === 'allocatedValue');
        const allocatedValue = allocatedValueObj ? allocatedValueObj.value : 0;

        const shipperId = item.shipper;
        const shipperName = item.group?.name || item.shipper;

        if (!acc[shipperId]) {
          acc[shipperId] = {
            gas_day: gasDay,
            shipper_id: shipperId,
            shipper_name: shipperName,
            allocatedValue: 0,
          };
        }
        acc[shipperId].allocatedValue += allocatedValue;
        return acc;
      }, {});

      const data = Object.values(groupedByShipper);
      const total = data.reduce((sum: number, item: any) => sum + item.allocatedValue, 0);

      // Calculate meter value for this point and gas_day
      let meterValue = null;
      if (getDataLogic?.meter) {
        // Find metering points that match this nomination point
        const activeDataForDate = activeData?.find((item: any) => isMatch(item.date, gasDay));
        const activeMeterRelateToNom = activeDataForDate?.activeMeteringPoints?.filter((meteringPoint: any) => isMatch(meteringPoint.nomination_point?.nomination_point, point));
        const activeMeterRelateToNonTpa = activeDataForDate?.activeMeteringPoints?.filter((meteringPoint: any) => (isMatch(meteringPoint.non_tpa_point_name, point)) || (isMatch(meteringPoint.nomination_point?.nomination_point, point)));
        // const matchingMeterPoints = getDataLogic.meterNom?.filter((meterPoint: any) => {
        //   const nominationPointName = meterPoint?.nomination_point?.nomination_point || 
        //                             meterPoint?.non_tpa_point?.nomination_point?.nomination_point;
        //   return isMatch(nominationPointName, point);
        // }) || [];

        // Calculate total meter value for this point on this gas_day
        let totalMeterValue = 0;
        activeMeterRelateToNom.forEach((meterPoint: any) => {
          const meterPointName = meterPoint.metered_point_name;

          // Find meter readings for this meter point on this gas_day
          const meterReadings = getDataLogic.meter.filter((reading: any) => {
            return isMatch(meterPointName, reading.meteringPointId) && (isMatch(gasDay, reading.gasDay) || isMatch(gasDay, reading.gas_day));
          });

          // Sum the energy values for this meter point
          meterReadings.forEach((reading: any) => {
            const energy = reading.value?.energy || reading.energy || 0;
            totalMeterValue += Number(energy) || 0;
          });
        });


        let totalMeterValueNonTpa = 0;
        activeMeterRelateToNonTpa.forEach((meterPoint: any) => {
          const meterPointName = meterPoint.metered_point_name;

          // Find meter readings for this meter point on this gas_day
          const meterReadings = getDataLogic.meter.filter((reading: any) => {
            return isMatch(meterPointName, reading.meteringPointId) && isMatch(gasDay, reading.gas_day);
          });

          // Sum the energy values for this meter point
          meterReadings.forEach((reading: any) => {
            const energy = reading.value?.energy || reading.energy || 0;
            totalMeterValueNonTpa += Number(energy) || 0;
          });
        });

        meterValue = totalMeterValue > 0 ? totalMeterValue : null;
        // if(meterValue && totalMeterValueNonTpa > 0){
        //   meterValue = meterValue - totalMeterValueNonTpa;
        // }
      }

      return {
        point,
        data,
        total,
        meterValue,
      };
    });

    return {
      gas_day: gasDay,
      nomPoint,
    };
  });

  // Sort by gas_day descending
  return result.sort((a, b) => b.gas_day.localeCompare(a.gas_day));
}


/**
 * Helper method to group allcation review data to allcation management structure
 */
export function groupDataAlloManage(data: any[]) {
  try {
    const priorityMap: any = {
      2: 1, // Highest priority
      3: 2,
      4: 3,
      5: 4,
      1: 5, // Lowest priority
    };

    const grouped: any = data.reduce((acc, item) => {
        const key = `${item.gas_day}-${item.point}`;

        if (!acc[key]) {
            acc[key] = {
                // id: generateRandomId(),
                id: item?.point + '_' + item.gas_day,
                gas_day: item.gas_day,
                point_text: item?.point,
                entry_exit: item?.entry_exit_obj?.name,

                nomination_value: 0,
                system_allocation: 0,
                intraday_system: 0,
                previous_allocation_tpa_for_review: 0,
                shipper_allocation_review: 0,
                metering_value: 0,

                data: [],
                priorityStatus: item?.allocation_status?.id ?? 999,
            };
        }

        acc[key].data.push(item);

        // Sum
        acc[key].nominationValue += Number(item?.nominationValue ?? 0);
        acc[key].systemAllocation += Number(item?.systemAllocation ?? 0);
        acc[key].intradaySystem += Number(item?.intradaySystem ?? 0);
        acc[key].previousAllocationTPAforReview += Number(item?.previousAllocationTPAforReview ?? 0);
        // acc[key].metering_value += Number(item?.meteringValue ?? 0);
        acc[key].meteringValue = Number(item?.meteringValue ?? 0);

        const shipperReview =
            item?.allocation_management_shipper_review?.[0]?.shipper_allocation_review ??
            item?.shipperAllocationReview ??
            0;
        acc[key].shipperAllocationReview += Number(shipperReview);

        // Update priority status if item has higher priority
        const currentPriority = priorityMap[acc[key].priorityStatus] ?? 999;
        const itemPriority = priorityMap[item.allocation_status?.id] ?? 999;

        if (itemPriority < currentPriority) {
            acc[key].priorityStatus = item.allocation_status?.id
        }

        return acc;
    }, {} as Record<string, any>);

    return Object.values(grouped);
  } catch (error) {
    return []
  }
};