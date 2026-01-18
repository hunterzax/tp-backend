import { PrismaService } from 'prisma/prisma.service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Helper function to find nomination points that need end date updates
 */
export async function findMoveEndDatePoints(
  prisma: PrismaService,
  pointName: string,
  startDate: Date,
  endDate: Date | null,
  refId?: number | null,
  targetTable?: string,
) {
  const dateConditionInOR: any[] = [
    //Prisma.nomination_pointWhereInput[] = [
    { end_date: null },
  ];

  const andInWhere: any[] = [
    {
      start_date: {
        lte: startDate,
      },
    },
  ];

  if (endDate) {
    dateConditionInOR.push({
      AND: [{ end_date: { gt: startDate } }, { end_date: { gt: endDate } }],
    });
  } else {
    dateConditionInOR.push({ end_date: { gt: startDate } });
  }

  andInWhere.push({
    OR: dateConditionInOR,
  });

  switch (targetTable) {
    case 'metering_point':
      if (refId) {
        andInWhere.push({
          OR: [
            {
              metered_point_name: pointName,
            },
            {
              id: refId,
            },
          ],
        });
      } else {
        andInWhere.push({
          metered_point_name: pointName,
        });
      }
      return await prisma.metering_point.findMany({
        where: {
          AND: andInWhere,
        },
        orderBy: { id: 'desc' },
        include: {
          customer_type: true,
        },
      });
    default:
      if (refId) {
        andInWhere.push({
          OR: [
            {
              nomination_point: pointName,
            },
            {
              id: refId,
            },
          ],
        });
      } else {
        andInWhere.push({
          nomination_point: pointName,
        });
      }
      return await prisma.nomination_point.findMany({
        where: {
          AND: andInWhere,
        },
        orderBy: { id: 'desc' },
      });
  }
}

/**
 * Helper function to find nomination points that need start date updates
 */
export async function findMoveStartDatePoints(
  prisma: PrismaService,
  pointName: string,
  startDate: Date,
  endDate: Date | null,
  refId?: number | null,
  targetTable?: string,
) {
  const andInWhere: any[] = [
    {
      start_date: { gte: startDate },
    },
    {
      OR: [
        { end_date: null },
        {
          AND: endDate
            ? [{ end_date: { gt: startDate } }, { end_date: { gt: endDate } }]
            : [{ end_date: { gt: startDate } }],
        },
      ],
    },
  ];

  if (endDate) {
    andInWhere.push({
      start_date: { lte: endDate },
    });
  }

  switch (targetTable) {
    case 'metering_point':
      if (refId) {
        andInWhere.push({
          OR: [
            {
              metered_point_name: pointName,
            },
            {
              id: refId,
            },
          ],
        });
      } else {
        andInWhere.push({
          metered_point_name: pointName,
        });
      }
      return await prisma.metering_point.findMany({
        where: {
          AND: andInWhere,
        },
        orderBy: { id: 'desc' },
      });
    default:
      if (refId) {
        andInWhere.push({
          OR: [
            {
              nomination_point: pointName,
            },
            {
              id: refId,
            },
          ],
        });
      } else {
        andInWhere.push({
          nomination_point: pointName,
        });
      }
      return await prisma.nomination_point.findMany({
        where: {
          AND: andInWhere,
        },
        orderBy: { id: 'desc' },
      });
  }
}

/**
 * Helper function to check if oldPoint should be added to move arrays
 */
export function shouldAddOldPointToEndDateArray(
  oldPoint: any,
  startDate: Date,
  endDate: Date | null,
): boolean {
  return (
    oldPoint.start_date <= startDate &&
    (oldPoint.end_date == null ||
      (endDate
        ? oldPoint.end_date > startDate && oldPoint.end_date > endDate
        : oldPoint.end_date > startDate))
  );
}

export function shouldAddOldPointToStartDateArray(
  oldPoint: any,
  startDate: Date,
  endDate: Date,
): boolean {
  return (
    oldPoint.start_date >= startDate &&
    oldPoint.start_date <= endDate &&
    (oldPoint.end_date == null ||
      (oldPoint.end_date > startDate && oldPoint.end_date > endDate))
  );
}

/**
 * Helper function to check if a new period should be BLOCKED (not just overlapping)
 * Returns true only for cases that should prevent the operation entirely
 */
export function shouldBlockNewPeriod(
  newStart: Date,
  newEnd: Date | null,
  existingStart: Date,
  existingEnd: Date | null,
): boolean {
  // Case 15: Block when new period conflicts with existing indefinite period
  if (!existingEnd) {
    // Block if new period starts same time as existing indefinite period
    if (newStart.getTime() === existingStart.getTime()) {
      // Block if new period overlaps with existing indefinite period
      // (new period ends after existing indefinite period starts)
      if (newEnd && newEnd > existingStart) {
        console.log(
          'BLOCKING Case 15: New period ends after existing indefinite period starts',
        );
        return true;
      }
    }
  }

  // Case 16: Both indefinite periods, new starts earlier
  if (!existingEnd && !newEnd && newStart < existingStart) {
    console.log(
      'BLOCKING Case 16: Both indefinite periods, new starts earlier',
    );
    return true;
  }

  // Case 8: Same periods (duplicate)
  if (
    newStart.getTime() === existingStart.getTime() &&
    ((newEnd && existingEnd && newEnd.getTime() === existingEnd.getTime()) ||
      (!newEnd && !existingEnd))
  ) {
    console.log('BLOCKING Case 8: Same periods (duplicate)');
    return true;
  }

  // Case 9: New starts same as existing but ends later
  if (
    newStart.getTime() === existingStart.getTime() &&
    newEnd &&
    existingEnd &&
    newEnd > existingEnd
  ) {
    console.log('BLOCKING Case 9: New starts same as existing but ends later');
    return true;
  }

  // Case 10: New starts earlier but ends same as existing
  if (
    newStart < existingStart &&
    newEnd &&
    existingEnd &&
    newEnd.getTime() === existingEnd.getTime()
  ) {
    console.log(
      'BLOCKING Case 10: New starts earlier but ends same as existing',
    );
    return true;
  }

  // Case 11: New starts earlier and ends later (completely contains existing)
  if (
    newStart < existingStart &&
    newEnd &&
    existingEnd &&
    newEnd > existingEnd
  ) {
    console.log(
      'BLOCKING Case 11: New starts earlier and ends later than existing',
    );
    return true;
  }

  // Case 5: New period is completely within existing period
  if (
    newStart > existingStart &&
    newEnd &&
    existingEnd &&
    newEnd < existingEnd
  ) {
    console.log(
      'BLOCKING Case 5: New period is completely within existing period',
    );
    return true;
  }

  // Additional indefinite period conflicts
  if (!newEnd && existingEnd && newStart <= existingStart) {
    console.log(
      'BLOCKING: New indefinite period starts before/same as existing finite period',
    );
    return true;
  }

  return false;
}

/**
 * Helper function to check if two date periods overlap and need adjustment
 * Returns true if periods overlap but can be auto-adjusted (not blocked)
 */
export function isPeriodsOverlapping(
  newStart: Date,
  newEnd: Date | null,
  existingStart: Date,
  existingEnd: Date | null,
): boolean {
  // First check if this should be blocked entirely
  if (shouldBlockNewPeriod(newStart, newEnd, existingStart, existingEnd)) {
    return false; // Don't treat blocked cases as simple overlaps
  }

  // Case 1: New period starts after existing starts but before existing ends
  // This should trigger auto-adjustment: set existing end_date = new start_date
  if (existingEnd && newStart < existingEnd && newStart > existingStart) {
    console.log(
      'ADJUSTABLE: New period starts during existing period - will auto-adjust existing end_date',
    );
    console.log('newStart', newStart);
    console.log('existingStart', existingStart);
    console.log('existingEnd', existingEnd);
    return true;
  }

  // Case 2: New period starts before existing period starts, but ends after existing starts
  // This should trigger auto-adjustment
  if (newEnd && newStart < existingStart && newEnd > existingStart) {
    console.log(
      'ADJUSTABLE: New period spans across existing start - will auto-adjust',
    );
    console.log('newStart', newStart);
    console.log('existingStart', existingStart);
    console.log('newEnd', newEnd);
    return true;
  }

  // Case 3: New period completely contains existing period
  // This should trigger auto-adjustment
  if (
    newEnd &&
    existingEnd &&
    newStart <= existingStart &&
    newEnd >= existingEnd
  ) {
    console.log(
      'ADJUSTABLE: New period completely contains existing period - will auto-adjust',
    );
    console.log('newStart', newStart);
    console.log('existingStart', existingStart);
    console.log('existingEnd', existingEnd);
    console.log('newEnd', newEnd);
    return true;
  }

  // Case 5: New period has no end date and starts before existing period ends or during it
  // This should trigger auto-adjustment
  if (
    !newEnd &&
    existingEnd &&
    newStart < existingEnd &&
    newStart > existingStart
  ) {
    console.log(
      'ADJUSTABLE: New indefinite period starts during existing period - will auto-adjust',
    );
    console.log('newStart', newStart);
    console.log('existingStart', existingStart);
    console.log('existingEnd', existingEnd);
    return true;
  }

  return false;
}

/**
 * Helper function to get a descriptive reason for the conflict
 */
export function getConflictReason(
  newStart: Date,
  newEnd: Date | null,
  existingStart: Date,
  existingEnd: Date | null,
): string {
  const formatDate = (date: Date) => dayjs(date).format('DD/MM/YYYY');

  if (!existingEnd) {
    // New period starts on same date or before existing indefinite period
    if (newStart <= existingStart) {
      return `conflicts with indefinite period starting ${formatDate(existingStart)}`;
    }
    // This case should rarely happen since new periods after indefinite periods are allowed
    return `already exists at ${formatDate(existingStart)}`;
  }

  if (!newEnd) {
    return `indefinite period conflicts with existing period (${formatDate(existingStart)} - ${formatDate(existingEnd)})`;
  }

  if (newStart <= existingStart && newEnd >= existingEnd) {
    return `completely contains existing period (${formatDate(existingStart)} - ${formatDate(existingEnd)})`;
  }

  if (newStart >= existingStart && newStart < existingEnd) {
    return `starts during existing period (${formatDate(existingStart)} - ${formatDate(existingEnd)})`;
  }

  if (newEnd > existingStart && newStart < existingStart) {
    return `ends during existing period (${formatDate(existingStart)} - ${formatDate(existingEnd)})`;
  }

  return `overlaps with existing period (${formatDate(existingStart)} - ${formatDate(existingEnd)})`;
}

export async function arrConfigSet(prisma: any, id: any) {
  const areaCode = [];
  const configMasterPath = await prisma.config_master_path.findMany({
    where: {
      id: { not: id },
    },
    include: {
      revised_capacity_path: {
        include: {
          area: true,
        },
      },
      revised_capacity_path_edges: true,
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
  configMasterPath.map(async (e: any) => {
    const setNodes = e?.revised_capacity_path?.map((area: any) => area?.area);
    const setEdges = e?.revised_capacity_path_edges?.map((area: any) => {
      return { source_id: area?.source_id, target_id: area?.target_id };
    });
    const filTypeStart = (setEdges && Array.isArray(setEdges)) ? setEdges.find((f: any) => {
      return !!f?.target_id;
    }) : null;
    const filNodesStart = (setNodes && Array.isArray(setNodes) && filTypeStart) ? setNodes.find((f: any) => {
      return f?.id === filTypeStart?.source_id;
    }) : null;

    const startSourceId = filNodesStart?.id;
    const result: any =
      (await this.getTargetSequence(startSourceId, setEdges)) || [];
    const areaArr = [];
    if (filNodesStart) {
      areaArr.push(filNodesStart);
    }
    if (result && Array.isArray(result) && setNodes && Array.isArray(setNodes)) {
      for (let i = 0; i < result.length; i++) {
        const idNode = setNodes.find((f: any) => {
          return f?.id === result[i];
        });
        if (idNode) {
          areaArr.push(idNode);
        }
      }
    }
    const newAreaArr = areaArr.map((ar: any) => ar?.id).join('');
    areaCode.push(newAreaArr);
    return e;
  });
  return { configMasterPath, areaCode };
}

export async function getTargetSequence(startSourceId: any, setEdges: any) {
  const result = [];
  let currentSourceId = startSourceId;

  while (true) {
    const found = setEdges.find((item) => item.source_id === currentSourceId);
    if (!found) break;
    result.push(found.target_id);
    currentSourceId = found.target_id;
  }

  return result;
}

export async function dfConfigSet(nodes: any, edges: any) {
  const starts = (edges && Array.isArray(edges)) ? edges.find((f: any) => {
    return !!f?.target_id;
  }) : null;
  const nodesStart = (nodes && Array.isArray(nodes) && starts) ? nodes.find((f: any) => {
    return f?.id === starts?.source_id;
  }) : null;

  const startSourceIdDf = nodesStart?.id;
  const resultDf: any = startSourceIdDf && edges ? (await getTargetSequence(startSourceIdDf, edges)) || [] : [];
  const areaArrCreate = [];
  if (resultDf && Array.isArray(resultDf) && nodes && Array.isArray(nodes)) {
    for (let i = 0; i < resultDf.length; i++) {
      const idNode = nodes.find((f: any) => {
        return f?.id === resultDf[i];
      });
      if (idNode) {
        areaArrCreate.push(idNode);
      }
    }
  }
  const newAreaArr =
    startSourceIdDf + areaArrCreate.map((ar: any) => ar?.id).join('');
  return newAreaArr;
}
