import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isBetween from 'dayjs/plugin/isBetween';
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');
 
// ------
export function getTodayStartAdd7(date: any = undefined) {
  return dayjs(date).startOf('day')
}

export function getTodayEndAdd7(date: any = undefined) {
  return dayjs(date).endOf('day')
}

export function getTodayNowAdd7(date: any = undefined) {
  return dayjs(date)
}
// ------
export function getYearStartAdd7(date: any = undefined) {
  return dayjs(date).startOf('year')
}

export function getYearEndAdd7(date: any = undefined) {
  return dayjs(date).endOf('year')
}
// ------
export function getTodayStart(date: any = undefined) {
  return dayjs(date).startOf('day'); // เวลาเริ่มของวันนี้
}

export function getTodayEnd(date: any = undefined) {
  return dayjs(date).endOf('day'); // เวลาสิ้นสุดของวันนี้
}

export function getTodayNow(date: any = undefined) {
  return dayjs(date); // เวลาวันนี้
}
// ------
export function getTodayStartDDMMYYYYAdd7(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY', true).startOf('day')
}

export function getTodayEndDDMMYYYYAdd7(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY', true).endOf('day')
}

export function getTodayNowDDMMYYYYAdd7(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY', true)
}
// ------
export function getTodayStartDDMMYYYYDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY').startOf('day')
}

export function getTodayEndDDMMYYYYDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY').endOf('day')
}

export function getTodayNowDDMMYYYYDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY')
}
export function getTodayNowDDMMYYYYDfault(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY'); // เวลาวันนี้ (UTC+7)
}
// ------

export function getTodayNowDDMMYYYYHHmmDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'DD/MM/YYYY HH:mm')
}
export function getTodayNowYYYYMMDDHHmmDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'YYYY-MM-DD HH:mm')
}
// ------
export function getTodayStartYYYYMMDDDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'YYYY-MM-DD').startOf('day')
}

export function getTodayEndYYYYMMDDDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'YYYY-MM-DD').endOf('day')
}

export function getTodayNowYYYYMMDDDfaultAdd7(date: any = undefined) {
  return dayjs(date, 'YYYY-MM-DD')
}
// ------
export async function checkStartEndBoom(
    el_start_date: any,
    el_end_date: any,
    start_date: any,
    end_date: any,
  ) {
    const e_start_date = dayjs(el_start_date);
    const e_end_date = el_end_date
      ? dayjs(el_end_date).subtract(1, "day")
      : null;
    const d_start_date = dayjs(start_date);
    const d_end_date = end_date ? dayjs(end_date) : null;

    let isOverlap = true;

    if (!d_end_date) {
      return e_end_date === null
        ? true
        : d_start_date.isBefore(e_end_date);
    }

    if (!e_end_date) {
      return !(
        d_end_date.isBefore(e_start_date) && d_start_date.isBefore(e_start_date)
      );
    }

    isOverlap =
      d_end_date.isBetween(e_start_date, e_end_date, null, '[)') ||
      d_start_date.isBetween(e_start_date, e_end_date, null, '[)') ||
      d_start_date.isSame(e_start_date) ||
      d_end_date.isSame(e_end_date) ||
      (d_start_date.isBefore(e_start_date) && d_end_date.isAfter(e_end_date));

    return isOverlap;
  }

// const todayStart = getTodayStartAdd7().toDate();
// const todayEnd = getTodayEndAdd7().toDate();

// const startDate = start_date ? getTodayStartAdd7(start_date).toDate() : null;
// const endDate = end_date ? getTodayEndAdd7(end_date).toDate() : null;

// const start = start_date ? getTodayStartAdd7(start_date) : null;
// const end = end_date ? getTodayEndAdd7(end_date) : null;

// const starts = startDate ? getTodayNowDDMMYYYYAdd7(startDate) : null;
// const ends = endDate ? getTodayNowDDMMYYYYAdd7(endDate) : null;


// start_date: start_date ? getTodayNowDDMMYYYYDfaultAdd7(start_date).toDate() : null,
// end_date: end_date ? getTodayNowDDMMYYYYDfaultAdd7(end_date).toDate() : null,

// start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
// end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,

// dayjs().tz('Asia/Bangkok').format('YYYY-MM-DDTHH:mm:ss.SSS[Z]')

// contract_start_date: minDate ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate() : null,
// contract_end_date: maxDate ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate() : null,

// contract_start_date: contract_start_date ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate() : null,
// contract_end_date: contract_end_date ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate() : null,
// submitted_timestamp: getTodayNowAdd7().toDate(),

/**
 * Helper function to get start and end of week (Sunday as start)
 */
export function getWeekRange(date: Date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diff = d.getDate() - day; // Sunday as start of week
  const weekStart = new Date(d.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

// ฟังก์ชันแปลงเวลา HH:mm เป็นนาทีสำหรับเปรียบเทียบ
export function timeToMinutes (timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};
