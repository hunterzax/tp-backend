import { getTodayEndYYYYMMDDDfaultAdd7, getTodayNowYYYYMMDDDfaultAdd7, getTodayStartYYYYMMDDDfaultAdd7 } from "./date.util";
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { PrismaService } from "prisma/prisma.service";
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');



// Mapping of property names to their corresponding tags
export const accImbValueMappings = {
  'all': 'accImb_or_accImbInv',
  'high_max_percentage': 'high_max_percentage',
  'high_dd_percentage': 'high_dd_percentage',
  'high_red_percentage': 'high_red_percentage',
  'high_orange_percentage': 'high_orange_percentage',
  'high_alert_percentage': 'high_alert_percentage',
  'low_max_percentage': 'low_max_percentage',
  'low_dd_percentage': 'low_dd_percentage',
  'low_red_percentage': 'low_red_percentage',
  'low_orange_percentage': 'low_orange_percentage',
  'low_alert_percentage': 'low_alert_percentage',
  'high_alert': 'high_alert',
  'high_orange': 'high_orange',
  'high_red': 'high_red',
  'high_dd': 'high_dd',
  'high_max': 'high_max',
  'baseInv': 'baseInv',
  'accImb_or_accImbInv': 'accImb_or_accImbInv',
  'accImb_or_accImbInv_percentage': 'accImb_or_accImbInv_percentage',
  'low_alert': 'low_alert',
  'low_orange': 'low_orange',
  'low_red': 'low_red',
  'low_dd': 'low_dd',
  'low_max': 'low_max'
};

export function groupAndFilterLatestData(resData: any[], baseReply: any[], accumReply: any[], meteringPointList: any[]) {
  // Create a map to store grouped data
  const groupedMap = new Map();

  // Process resData (intraday_base_inentory)
  if (resData && Array.isArray(resData)) {
    resData.forEach(item => {
      const gasDay = item.gas_day_text;
      const gasHour = item.gas_hour || null;
      const timestamp = item.timestamp;
      const zone = item.zone_text;
      const mode = item.mode;
      const key = `${gasDay}_${gasHour || 'null'}|${zone}|${mode}`;

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          gasDay,
          gasHour,
          zone,
          mode,
          resData: null,
          baseReply: null,
          latestTimestamp: null
        });
      }
      const group = groupedMap.get(key);

      // Keep the latest timestamp
      if (!group.latestTimestamp || compareTimestamps(timestamp, group.latestTimestamp) > 0) {
        group.latestTimestamp = timestamp;
        group.resData = item;
      }
    });
  }

  // Process baseReply (tpa_metering.base_inventory)
  if (baseReply && Array.isArray(baseReply)) {
    baseReply.forEach(item => {
      const gasDay = item.gasDay;
      const gasHour = item.gasHour || null;
      const insertTimestamp = item.insert_timestamp;
      const zone = item.zone;
      const mode = item.mode;
      const key = `${gasDay}_${gasHour || 'null'}|${zone}|${mode}`;

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          gasDay,
          gasHour,
          zone,
          mode,
          resData: null,
          baseReply: null,
          latestTimestamp: null
        });
      }

      const group = groupedMap.get(key);

      // Keep the latest insert_timestamp
      if (!group.latestTimestamp || compareTimestamps(insertTimestamp, group.latestTimestamp) > 0) {
        group.latestTimestamp = insertTimestamp;
        group.baseReply = item;
      }
    });
  }

  // Convert grouped data to the desired format
  const heatingValueOFOIF: any = {}
  meteringPointList.map((item: any) => {
    if (item.hv_type_id == 2 && item.group?.id_name) {
      heatingValueOFOIF[`heatingValue_OFOIF_${item.group.id_name}`] = item.meterData?.heatingValue
    }
    else { //if(item.hv_type_id == 1) {
      heatingValueOFOIF.heatingValue_OFOIF_system = item.meterData?.heatingValue
    }
  })

  const result = Array.from(groupedMap.values()).map(group => {
    const resDataItem = group.resData;
    const baseReplyItem = group.baseReply;
    // const accumReplyItem = group.accumReply;
    const accumReplyInGasDay = accumReply.filter((item: any) => item.gasDay === group.gasDay);
    const accumReplyItem = accumReplyInGasDay.length > 0
      ? accumReplyInGasDay.reduce((latest, current) => {
        return compareTimestamps(current.insert_timestamp, latest.insert_timestamp) > 0 ? current : latest;
      })
      : null;

    // Create the result object based on the desired format
    return {
      gas_day_text_DDMMYY: getTodayNowYYYYMMDDDfaultAdd7(group.gasDay).format('DD/MM/YYYY'),
      id: resDataItem?.id || null,
      gas_day: resDataItem?.gas_day || getTodayNowYYYYMMDDDfaultAdd7(baseReplyItem?.gasDay).toISOString() || null,
      gas_day_text: group.gasDay || null,
      gas_hour: group.gasHour || null,
      timestamp: group.latestTimestamp || null,
      zone_text: group.zone || null,
      mode: group.mode || null,
      hv: resDataItem?.hv || baseReplyItem?.hv || null,
      base_inventory_value: resDataItem?.base_inventory_value || baseReplyItem?.base_inventory || null,
      high_difficult_day: resDataItem?.high_difficult_day || baseReplyItem?.high_threshold_dd || null,
      high_red: resDataItem?.high_red || baseReplyItem?.high_threshold_red || null,
      high_orange: resDataItem?.high_orange || baseReplyItem?.high_threshold_orange || null,
      high_max: resDataItem?.high_max || baseReplyItem?.high_threshold_max || null,
      alert_high: resDataItem?.alert_high || baseReplyItem?.high_threshold_alert || null,
      alert_low: resDataItem?.alert_low || baseReplyItem?.low_threshold_alert || null,
      low_orange: resDataItem?.low_orange || baseReplyItem?.low_threshold_orange || null,
      low_red: resDataItem?.low_red || baseReplyItem?.low_threshold_red || null,
      low_difficult_day: resDataItem?.low_difficult_day || baseReplyItem?.low_threshold_dd || null,
      low_max: resDataItem?.low_max || baseReplyItem?.low_threshold_max || null,
      totalInv: (group?.zone?.trim()?.toUpperCase() === 'EAST') ? (accumReplyItem?.east_value || null) : (group?.zone?.trim()?.toUpperCase() === 'WEST') ? (accumReplyItem?.west_value || null) : null,
      del_flag: resDataItem?.del_flag || null,
      active: resDataItem?.active || null,
      create_date: resDataItem?.create_date || null,
      update_date: resDataItem?.update_date || null,
      create_date_num: resDataItem?.create_date_num || null,
      update_date_num: resDataItem?.update_date_num || null,
      create_by: resDataItem?.create_by || null,
      update_by: resDataItem?.update_by || null,
      create_by_account: resDataItem?.create_by_account || null,
      update_by_account: resDataItem?.update_by_account || null,
      zoneObj: resDataItem?.zoneObj || null,
      // Add baseReply and accumReply data if needed
      baseReply: baseReplyItem,
      // accumReply: accumReplyItem
      ...heatingValueOFOIF
    };
  });

  // Sort by gas_day_text and gas_hour
  return result.sort((a, b) => {
    if (a.gas_day_text !== b.gas_day_text) {
      return new Date(a.gas_day_text).getTime() - new Date(b.gas_day_text).getTime();
    }
    if (a.gas_hour !== b.gas_hour) {
      return (String(a.gas_hour || '')).localeCompare(String(b.gas_hour || ''));
    }
    return 0;
  });
}

export function compareTimestamps(timestamp1: any, timestamp2: any): number {
  // Handle different timestamp formats
  const getTimestampValue = (timestamp: any): number => {
    if (typeof timestamp === 'number') {
      return timestamp;
    }
    if (typeof timestamp === 'string') {

      const dayjsTimestamp = dayjs(timestamp, 'YYYY-MM-DD HH:mm:ss');
      if (dayjsTimestamp.isValid()) {
        return dayjsTimestamp.valueOf();
      }

      // Try to parse as date string
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date.getTime();
      }
      // Try to parse as number string
      const num = parseFloat(timestamp);
      if (!isNaN(num)) {
        return num;
      }
    }
    return 0;
  };

  const val1 = getTimestampValue(timestamp1);
  const val2 = getTimestampValue(timestamp2);

  return val1 - val2;
}

// export function formatDateDDMMYY(dateString: string): string {
//   if (!dateString) return '';

//   try {
//     const date = new Date(dateString);
//     if (isNaN(date.getTime())) return '';

//     const day = date.getDate().toString().padStart(2, '0');
//     const month = (date.getMonth() + 1).toString().padStart(2, '0');
//     const year = date.getFullYear().toString().slice(-2);

//     return `${day}/${month}/${year}`;
//   } catch (error) {
//     return '';
//   }
// }

export function getGasHourValue(gasHour: any): number {
  if (!gasHour) return 0;
  if (typeof gasHour === 'number') {
    return gasHour;
  }
  if (typeof gasHour === 'string') {
    // Try to parse as HH:MM format
    const parts = gasHour.split(':');
    if (parts.length === 2) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (!isNaN(hours) && !isNaN(minutes)) {
        return hours * 60 + minutes; // Convert to minutes for comparison
      }
    }
    // Try to parse as number string
    const num = parseFloat(gasHour);
    if (!isNaN(num)) {
      return num;
    }
  }
  return 0;
};

export function compareGasHour(gasHour1: any, gasHour2: any): number {
  // Handle different gas hour formats

  const val1 = getGasHourValue(gasHour1);
  const val2 = getGasHourValue(gasHour2);

  return val1 - val2;
}

export async function findMinMaxExeDate(prisma: PrismaService, start_date: any, end_date: any) {
  try {
    const todayStartf = getTodayStartYYYYMMDDDfaultAdd7(start_date);
    const todayEndf = getTodayEndYYYYMMDDDfaultAdd7(end_date);

    const executeEod = await prisma.execute_eod.findMany({
      where: {
        AND: [
          {
            start_date_date: {
              lte: todayEndf.toDate(), // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
            },
          },
          {
            OR: [
              { end_date_date: null }, // ถ้า end_date เป็น null
              { end_date_date: { gte: todayStartf.toDate() } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
        status: "OK"
      },
    })
    // console.log('executeEod : ', executeEod);
    // execute_timestamp

    const nexecuteEod = executeEod?.flatMap((e: any) => {
      const { start_date_date, end_date_date } = e
      return [
        start_date_date,
        end_date_date,
      ]

    })?.filter((f: any) => !!f)

    const parsed = nexecuteEod.map(d => dayjs(d)).filter(d => d.isValid());

    if (parsed.length === 0) {
      console.log('No valid dates found in executeEod');
      return { minDate: null, maxDate: null };
    }

    const minDateFromExe = parsed.reduce((min, curr) => curr.isBefore(min) ? curr : min);
    const maxDateFromExe = parsed.reduce((max, curr) => curr.isAfter(max) ? curr : max);

    const minDate = minDateFromExe ? dayjs.max([minDateFromExe, todayStartf]) : null;
    const maxDate = maxDateFromExe ? dayjs.min([maxDateFromExe, todayEndf]) : null;

    console.log('minDate : ', minDate);
    console.log('maxDate : ', maxDate);

    return {
      minDate,
      maxDate
    }
  }
  catch (error) {
    console.log('findMinMaxExeDate error : ', error);
    return {
      minDate: null,
      maxDate: null
    }
  }
}

// Helper function to extract value by tag
export function getValueByTag(thisHourData: any, tag: string) {
  return thisHourData?.values?.find((f: any) => f?.tag === tag)?.value ?? null
};
