import { Injectable } from '@nestjs/common';
import { getTodayEndAdd7, getTodayEndYYYYMMDDDfaultAdd7, getTodayNow, getTodayNowAdd7, getTodayStartAdd7, getTodayStartYYYYMMDDDfaultAdd7, getWeekRange } from 'src/common/utils/date.util';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import axios from 'axios';
import { AdjEvent, AstosRepository } from './astos.repository';
import { AstosUtils } from './astos.utils';
import { consoleIntegration } from '@sentry/nestjs';
import { divide } from 'lodash';
import { match } from 'assert';
import { statSync } from 'fs';

dayjs.extend(customParseFormat);

@Injectable()
export class AstosService {
  constructor(
    private readonly repo: AstosRepository,
    private readonly utils: AstosUtils,
  ) { }

  // ===== NOTIC =====
  private async providerNotiInapp(type: string, message: string, email: string[]) {
    // basic safety: ensure configured endpoint uses http/https
    try {
      const u = new URL(String(process.env.IN_APP_URL));
      if (!['http:', 'https:'].includes(u.protocol)) {
        throw new Error('IN_APP_URL must use http/https');
      }
    } catch (e) {
      throw new Error(`Invalid IN_APP_URL: ${e?.message || 'unknown'}`);
    }

    await axios.post(`${process.env.IN_APP_URL}`, {
      extras: { email }, message: message || '', priority: 1, title: type || '',
    }, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.IN_APP_TOKEN}` },
      maxBodyLength: Infinity,
    });
  }

  private async executeNotiInapp(type: string, message: string) {
    const accounts = await this.repo.getInAppNotiRecipients(82);
    const emailArr = (accounts || []).map((a: any) => a.email).filter(Boolean);
    await this.providerNotiInapp(type, message, emailArr);
  }

  // ===== PUT UPDATE STATUS =====
  async execute_updateStatus_eod(payload: { request_number: any; execute_timestamp: any; finish_timestamp: any; status: string; msg?: string; }) {
    const { request_number, execute_timestamp, finish_timestamp, status, msg } = payload;
    const nowAt = getTodayNow();
    try {
      const updateUnique = {
        request_number_id: Number(request_number),
        execute_timestamp: Number(execute_timestamp)
      };
      const updateInfo = { finish_timestamp, status, ...(msg != null ? { msg } : {}) };
      const find = await this.repo.findExecuteEod(updateUnique);
      if (find) {
        await this.repo.updateExecuteEod(updateUnique, updateInfo);
        console.log(`[DEBUG] update eod status: ${execute_timestamp} ${status}`)
        if (status === 'OK') {
          console.log(`[DEBUG] status is ok`)
          await this.repo.updateReviewStatus(Number(execute_timestamp));
          const message = `The allocation and balancing process for all shippers and the following period of time: {${getTodayNow(find?.start_date).format('DD/MM/YYYY')} to ${getTodayNow(find?.end_date).format('DD/MM/YYYY')}} {has finished OK} {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
          // await this.executeNotiInapp('Execute EOD', message);
          return { request_number, execute_timestamp, finish_timestamp, status_code: 200 };
        } else {
          const message = `The allocation and balancing process for all shippers and the following period of time: {${getTodayNow(find?.start_date).format('DD/MM/YYYY')} to ${getTodayNow(find?.end_date).format('DD/MM/YYYY')}} has failed {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
          // await this.executeNotiInapp('Execute EOD', message);
          return { request_number, execute_timestamp, finish_timestamp, status_code: 200 };
        }
      } else {
        const message = `The allocation and balancing process for all shippers for the following time has failed due to data inconsistency. {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
        // await this.executeNotiInapp('Execute EOD', message);
        return { request_number, execute_timestamp, finish_timestamp, status_code: 500 };
      }
    } catch (error) {
      const message = `The allocation and balancing process for all shippers for the following time has failed due to data inconsistency. {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
      // await this.executeNotiInapp('Execute EOD', message);
      return { request_number, execute_timestamp, finish_timestamp, status_code: 500 };
    }
  }

  async execute_updateStatus_intraday(payload: { request_number: any; execute_timestamp: any; finish_timestamp: any; status: string; msg?: string; }) {
    const { request_number, execute_timestamp, finish_timestamp, status, msg } = payload;
    const nowAt = getTodayNow();
    try {
      const updateUnique = {
        request_number_id: Number(request_number),
        execute_timestamp: Number(execute_timestamp)
      };
      const updateInfo = { finish_timestamp, status, ...(msg != null ? { msg } : {}) };
      const find = await this.repo.findExecuteIntraday(updateUnique);
      if (find) {
        await this.repo.updateExecuteIntraday(updateUnique, updateInfo);
        if (status === 'OK') {
          const message = `The allocation and balancing process for all shippers and the following time: {${getTodayNow(find?.gas_day).format('DD/MM/YYYY')}} {has finished OK} {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
          // await this.executeNotiInapp('Execute Intraday', message);
          return { request_number, execute_timestamp, finish_timestamp, status_code: 200 };
        } else {
          const message = `The allocation and balancing process for all shippers and the following time: {${getTodayNow(find?.gas_day).format('DD/MM/YYYY')}} has failed {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
          // await this.executeNotiInapp('Execute Intraday', message);
          return { request_number, execute_timestamp, finish_timestamp, status_code: 200 };
        }
      } else {
        const message = `The allocation and balancing process for all shippers during the following period has failed due to data mismatch. {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
        // await this.executeNotiInapp('Execute Intraday', message);
        return { request_number, execute_timestamp, finish_timestamp, status_code: 500 };
      }
    } catch (error) {
      const message = `The allocation and balancing process for all shippers during the following period has failed due to data mismatch. {(process executed on ${nowAt.format('DD/MM/YYYY')})}.`;
      // await this.executeNotiInapp('Execute Intraday', message);
      return { request_number, execute_timestamp, finish_timestamp, status_code: 500 };
    }
  }

  // ===== GET DATA =====
  async eviden_contract(payload: any) {
    const { start_date, end_date, skip, limit } = payload;

    const dayStart = getTodayStartAdd7(start_date).toDate();
    const dayEnd = getTodayStartAdd7(end_date).toDate();
    const rows = await this.repo.findContractsForEvidence(dayStart, dayEnd);

    const data = rows.map((e: any) => {
      const contract_point = e.booking_version?.[0]?.booking_row_json?.map((cp: any) => cp?.contract_point);
      return {
        contract: e.contract_code,
        shipper: e.group?.id_name,
        start_date: getTodayNow(e.contract_start_date).format('YYYY-MM-DD'),
        end_date: getTodayNow(e.contract_end_date).format('YYYY-MM-DD'),
        contract_point,
      };
    });

    return { total_record: data.length, status_code: 200, data };
  }

  async eviden_contract_capacity(payload: any) {
    const { start_date, end_date, skip, limit } = payload;

    const dayStart = getTodayStartAdd7(start_date).toDate();
    const dayEnd = getTodayStartAdd7(end_date).toDate();

    const rows = await this.repo.findContractsForEvidence(dayStart, dayEnd);

    const resultPerDay = (rows ?? []).flatMap((e: any) => {
      const bookingFullJson = e.booking_version?.[0]?.booking_full_json?.[0];
      if (!bookingFullJson?.data_temp) return [];

      const full = this.utils.safeParse(bookingFullJson.data_temp);

      // ----- pick capacity header & change points (unchanged) -----
      const head = full?.headerEntry?.['Capacity Daily Booking (MMBTU/d)'] || {};
      if (head && typeof head === 'object') delete (head as any)['key'];

      interface ChangePoint { at: dayjs.Dayjs; key: string }
      const changePoints: ChangePoint[] = Object.entries(head || {})
        .filter(([k, v]) => /\d{2}\/\d{2}\/\d{4}/.test(k) && v && typeof v === 'object' && 'key' in (v as any))
        .map(([k, v]) => ({ at: dayjs(k, 'DD/MM/YYYY', true), key: String((v as any).key) }))
        .sort((a, b) => a.at.valueOf() - b.at.valueOf());

      const fallbackKey: string | null =
        (full?.headerEntry?.['Capacity Daily Booking (MMBTU/d)']?.key as string) ??
        (changePoints[0]?.key ?? null);

      const selectKeyAsOf = (() => {
        let i = 0;
        return (dISO: string): string | null => {
          if (!fallbackKey && changePoints.length === 0) return null;
          const d = dayjs(dISO, 'YYYY-MM-DD', true);
          while (i + 1 < changePoints.length && changePoints[i + 1].at.isSameOrBefore(d)) i++;
          if (changePoints.length === 0) return fallbackKey;
          if (changePoints[0].at.isAfter(d)) return fallbackKey;
          return changePoints[i].key;
        };
      })();

      // ----- period keys ("5"=From, "6"=To) -----
      const periodFromKey = full?.headerEntry?.Period?.From?.key ?? '5';
      const periodToKey = full?.headerEntry?.Period?.To?.key ?? '6';

      const rowsJson =
        e.booking_version?.[0]?.booking_row_json?.map((r: any) => ({
          ...r,
          data_temp: this.utils.safeParse(r.data_temp),
        })) || [];

      const days = this.utils.expandGasDays(start_date, end_date);

      const flatOut: any[] = [];
      for (const dISO of days) {
        const d = dayjs(dISO, 'YYYY-MM-DD', true);
        const key = selectKeyAsOf(dISO);

        for (const r of rowsJson) {
          // ---- read row's period window and gate the value ----
          const fromStr = r.data_temp?.[periodFromKey];
          const toStr = r.data_temp?.[periodToKey];

          const from = fromStr ? dayjs(fromStr, 'DD/MM/YYYY', true) : null; // inclusive
          const to = toStr ? dayjs(toStr, 'DD/MM/YYYY', true) : null; // exclusive

          const inLowerBound = !from || !from.isValid() || d.isSameOrAfter(from, 'day');
          const inUpperBound = !to || !to.isValid() || d.isBefore(to, 'day');
          const isInWindow = inLowerBound && inUpperBound;

          const value = isInWindow && key
            ? this.utils.asNumber(r?.data_temp?.[key])
            : 0;

          flatOut.push({
            contract: e.contract_code,
            shipper: e.group?.id_name,
            contract_point: r.contract_point,
            area: r.area_text,
            entry_exit: r.entry_exit_id === 1 ? 'ENTRY' : 'EXIT',
            zone: r.zone_text,
            dates: dISO,
            value,
          });
        }
      }

      return flatOut;
    });

    // ---- grouping (unchanged) ----
    const byDay = new Map<string, any[]>();
    for (const row of resultPerDay) {
      const k = row.dates;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(row);
    }

    const result = Array.from(byDay.entries()).map(([d, arr]) => {
      const k2 = new Map<string, any>();
      for (const a of arr) {
        const k = `${a.contract}|${a.shipper}`;
        if (!k2.has(k)) k2.set(k, { contract: a.contract, shipper: a.shipper, data: [] as any[] });
        k2.get(k)!.data.push({
          contract_point: a.contract_point,
          area: a.area,
          entry_exit: a.entry_exit,
          zone: a.zone,
          value: a.value,
        });
      }
      return { gas_day: d, data: Array.from(k2.values()) };
    });

    const data = this.utils.paginate(result, skip, limit);
    return { total_record: data.length, status_code: 200, data };
  }

  async eviden_nomination_eod(payload: any) {
    const { start_date, end_date, skip, limit } = payload;

    // Build day list (ISO yyyy-mm-dd in UTC+7)
    const startISO = getTodayStartAdd7(start_date).format('YYYY-MM-DD');
    const endISO = getTodayStartAdd7(end_date).format('YYYY-MM-DD');
    const gasDays = this.utils.expandGasDays(startISO, endISO);

    // Prefetch
    const dayStart = getTodayStartAdd7(start_date).toDate();
    const dayEnd = getTodayStartAdd7(end_date).toDate();

    const contracts = await this.repo.getContractsInRange(dayStart, dayEnd);
    const filesMap = await this.repo.getPreferredNomFiles(contracts.map(c => c.id), dayStart, dayEnd);
    const [nomDam, nonTpaDam, alloMode] = await Promise.all([
      this.repo.getDamNomPoints(dayStart, dayEnd),
      this.repo.getDamNonTpaPoints(dayStart, dayEnd),
      this.repo.getAllocationModes(dayEnd),
    ]);

    // Prepare lookups
    const nomMap = new Map((nomDam ?? []).map((n: any) => [n.nomination_point, {
      entry_exit: n.entry_exit?.name ?? null,
      zone: n.zone?.name ?? null,
      area: n.area?.name ?? null,
      customer_type: n.customer_type?.name ?? null,
      cpList: (n.contract_point_list ?? []).map((x: any) => x.contract_point),
    }]));

    const nonTpaMap = new Map((nonTpaDam ?? []).map((nt: any) => [nt.non_tpa_point_name, {
      base_point: nt.nomination_point?.nomination_point ?? null,
      entry_exit: nt.nomination_point?.entry_exit?.name ?? null,
      zone: nt.nomination_point?.zone?.name ?? null,
      area: nt.nomination_point?.area?.name ?? null,
    }]));


    const contractCPs = await this.repo.getContractAllowedCPs(contracts.map(c => c.contract_code));

    const modeForDay = (iso: string) => {
      const day = getTodayStartAdd7(iso).toDate();
      let mode: string | null = null;
      for (const r of (alloMode || [])) { if (r.start_date <= day) mode = r.allocation_mode_type?.mode ?? null; else break; }
      return mode || 'Daily Allocation Mode';
    };

    const out: { gas_day: string; contract: string; shipper: string; data: any[] }[] = [];

    for (const gd of gasDays) {
      const mode = modeForDay(gd);
      if (mode === 'Intraday Allocation Mode') {
        const res = await this.eviden_nomination_intraday({ gas_day: gd, start_hour: 24, end_hour: 24, skip: 0, limit: 0 });
        for (const r of (res?.data ?? [])) out.push({ gas_day: r.gas_day, contract: r.contract, shipper: r.shipper, data: r.data });
        continue;
      }

      // Daily Allocation Mode
      const buckets = new Map<string, { gas_day: string; contract: string; shipper: string; data: any[] }>();
      const push = (gas_day: string, contract: string, shipper: string, item: any, isDaily: boolean) => {
        const key = `${gas_day}|${contract}|${shipper}`;
        if (!buckets.has(key)) buckets.set(key, { gas_day, contract, shipper, data: [] });
        this.utils.insertOrMerge(buckets.get(key)!.data, item, 'DAILY_OVERRIDES_WEEKLY', isDaily);
      };

      for (const ctr of contracts) {
        const files = filesMap.get(ctr.id) || [];
        const dayFiles = files.filter((f: any) => getTodayNow(f.gas_day as any).format('YYYY-MM-DD') === gd);
        const { weekStart, weekEnd } = getWeekRange(new Date(gd));
        const weekFiles = files.filter((f: any) => getTodayNow(f.gas_day as any).format('YYYY-MM-DD') === dayjs(weekStart).format('YYYY-MM-DD'));
        const hasDaily = dayFiles.some((f: any) => this.utils.toUpper(f.nomination_type?.name) === 'DAILY');
        const chosen = hasDaily ? dayFiles.filter((f: any) => this.utils.toUpper(f.nomination_type?.name) === 'DAILY') : weekFiles.filter((f: any) => this.utils.toUpper(f.nomination_type?.name) === 'WEEKLY');

        for (const file of chosen) {
          const isDaily = this.utils.toUpper(file.nomination_type?.name) === 'DAILY';
          const full = file.nomination_version?.[0]?.nomination_full_json?.[0];
          if (!full?.data_temp) continue;
          const obj = this.utils.safeParse(full.data_temp);
          const head = obj?.headData ?? {};
          const rows: any[] = obj?.valueData ?? [];

          const colKey = this.utils.resolveColumnKey(head, gd, isDaily).trim();
          if (!colKey) continue;

          for (const row of rows) {
            const unit = this.utils.toUpper(row['9']);
            if (unit !== 'MMBTU/D') { continue; }

            const point = [row['3'], row['5']].map((v: any) => (v ?? '').toString().trim()).find((v: string) => v.length > 0);
            if (!point) continue;
            const val = this.utils.asNumber(row[colKey]);
            // console.log(`${ctr.contract_code} ${point}: ${val} from \"${colKey}\"`);
            if (val == null || Number.isNaN(val)) continue;
            const Value = isDaily ? this.utils.round3(val) : this.utils.round3(val / 24);

            const allowed = contractCPs.get(ctr.contract_code) ?? new Set<string>();
            const nm = nomMap.get(point);
            const nt = nonTpaMap.get(point);
            const zone = this.utils.toUpper(row['0']) ?? null;
            if (nm) {
              const cp = (nm.cpList ?? []).find((x: string) => allowed.has(x)) ?? null;
              const entryExit = (nm.entry_exit ?? row['10'])?.toString().toUpperCase() ?? null;
              if (!cp) { continue; }
              push(gd, ctr.contract_code, ctr.group?.id_name as any, {
                point, point_type: 'NOM', customer_type: nm.customer_type ?? null,
                relation_point: cp, relation_point_type: cp ? 'CONTRACT' : null,
                area: nm.area ?? (row['2'] ?? null),
                zone: nm.zone ?? (row['0'] ?? null),
                entry_exit: entryExit,
                value: Value,
              }, isDaily);
            }
            else if (nt) {
              const entryExit = (nt.entry_exit ?? row['10'])?.toString().toUpperCase() ?? null;
              push(gd, ctr.contract_code, ctr.group?.id_name as any, {
                point, point_type: 'NONTPA', customer_type: null,
                relation_point: nt.base_point, relation_point_type: 'NOM',
                area: nt.area ?? (row['2'] ?? null),
                zone: nt.zone ?? (this.utils.toUpper(row['0']) ?? null),
                entry_exit: entryExit,
                value: Value,
              }, isDaily);
            }
            else if (zone) { // concept point
              // console.log(`${ctr.contract_code} ${point} ${this.utils.toUpper(row['0'])}: ${Value} (${colKey}=${row[colKey]})`);
              push(gd, ctr.contract_code, ctr.group?.id_name as any, {
                point, point_type: 'CONCEPT', customer_type: null,
                relation_point: null, relation_point_type: null,
                // area: row['2'] ?? null,
                area: null,
                zone: zone,
                // entry_exit: this.utils.toUpper(row['10']) ?? 'EXIT',
                entry_exit: null,
                value: Value,
              }, isDaily);
            }
          }
        }
      }
      out.push(...Array.from(buckets.values()));
    }

    out.sort((a, b) => a.gas_day.localeCompare(b.gas_day) || a.contract.localeCompare(b.contract) || a.shipper.localeCompare(b.shipper));
    const data = this.utils.paginate(out, skip, limit);
    return { total_record: data.length, status_code: 200, data };
  }

  async prepare_daily_adjustment_data(payload: any): Promise<{
    byHourPoint: Map<string, Set<string>>
    orderedAdjCodes: string[]
    hasAdjKey: Set<string>
    baseIndex: Map<string, { total: number, members: any[] }>
    deviders: Map<string, number>
    shipperPointAdj: Map<string, AdjEvent[]>
    groups: Map<string, {
      gas_day: string;
      gas_hour: number;
      contract: string;
      shipper: string;
      data: any[];
    }>
  }> {
    const { gas_day, start_hour, end_hour } = payload;
    const { fromH, toH } = this.utils.normalizeHourWindow(start_hour, end_hour);

    const reqFrom = Math.max(1, fromH ?? 1);
    const reqTo = Math.min(24, toH ?? 24)
    const buildFrom = 1;       // always start at hour 1
    const buildTo = reqTo;   // only need up to the latest requested hour 
    const dayStart = getTodayStartYYYYMMDDDfaultAdd7(gas_day).toDate();
    const dayEnd = getTodayEndYYYYMMDDDfaultAdd7(gas_day).toDate();

    // Contracts + files
    const contracts = await this.repo.getContractsInRange(dayStart, dayEnd);
    const filesMap = await this.repo.getPreferredNomFiles(contracts.map(c => c.id), dayStart, dayEnd);

    // Lookups
    const [nomDam, nonTpaDam, dailyAdjust] = await Promise.all([
      this.repo.getDamNomPoints(dayStart, dayEnd),
      this.repo.getDamNonTpaPoints(dayStart, dayEnd),
      this.repo.getDailyAdjustments(getTodayStartAdd7(gas_day).toDate()),
    ]);
    console.log('[nom_intra:debug] inputs', {
      contracts: contracts?.length ?? 0,
      nomDam: nomDam?.length ?? 0,
      nonTpaDam: nonTpaDam?.length ?? 0,
      dailyAdjust: dailyAdjust?.length ?? 0,
    });

    // Build lookups
    const nomMap = new Map((nomDam ?? []).map((n: any) => [n.nomination_point, {
      entry_exit: n.entry_exit?.name ?? null,
      zone: n.zone?.name ?? null,
      area: n.area?.name ?? null,
      customer_type: n.customer_type?.name ?? null,
      cpList: (n.contract_point_list ?? []).map((x: any) => x.contract_point),
    }]));
    const nonTpaMap = new Map((nonTpaDam ?? []).map((nt: any) => [nt.non_tpa_point_name, {
      base_point: nt.nomination_point?.nomination_point ?? null,
      entry_exit: nt.nomination_point?.entry_exit?.name ?? null,
      zone: nt.nomination_point?.zone?.name ?? null,
      area: nt.nomination_point?.area?.name ?? null,
    }]));


    const contractCPs = await this.repo.getContractAllowedCPs(contracts.map(c => c.contract_code));

    // Baseline groups per hour (fromH..toH)
    const groups = new Map<string, { gas_day: string; gas_hour: number; contract: string; shipper: string; data: any[] }>();
    const pushHour = (gasDayISO: string, hour: number, contract: string, shipper: string, item: any, isDaily: boolean) => {
      const gas_day_s = getTodayNow(gasDayISO).format('YYYY-MM-DD');
      const key = `${gas_day_s}|${hour}|${contract}|${shipper}`;
      if (!groups.has(key)) groups.set(key, { gas_day: gas_day_s, gas_hour: hour, contract, shipper, data: [] });
      this.utils.insertOrMerge(groups.get(key)!.data, item, 'DAILY_OVERRIDES_WEEKLY', isDaily);
    };

    for (const ctr of contracts) {
      const files = filesMap.get(ctr.id) || [];
      for (const file of files) {
        const gasDayISO = getTodayNow(file.gas_day as any).format('YYYY-MM-DD');
        const isDaily = this.utils.toUpper(file.nomination_type?.name) === 'DAILY';
        const version = file.nomination_version?.[0];
        const full = version?.nomination_full_json?.[0];
        if (!full?.data_temp) continue;

        const obj = this.utils.safeParse(full.data_temp);
        const head = obj?.headData ?? {};
        const rows: any[] = obj?.valueData ?? [];

        // Weekly: resolve the date column once per file
        // const weeklyColKey = !isDaily ? this.utils.resolveColumnKey(head, gasDayISO, false) : null;
        let weeklyColKey: { string: string } | null = null;
        if (!isDaily) {
          // Get the week's start/end dates containing gasDayISO
          const weekRange = getWeekRange(file.gas_day);

          // Loop through each day in the week
          for (let d = weekRange.weekStart; d <= weekRange.weekEnd; d = dayjs(d).add(1, 'day').toDate()) {
            // Only process if day falls within dayStart-dayEnd range
            if (d >= dayStart && d <= dayEnd) {
              const gasDayISOEachDay = dayjs(d).format('YYYY-MM-DD')
              const weeklyColKeyEachDay = this.utils.resolveColumnKey(head, gasDayISOEachDay, false);
              if (weeklyColKeyEachDay) {
                if (weeklyColKey) {
                  weeklyColKey[gasDayISOEachDay] = weeklyColKeyEachDay;
                }
                else {
                  weeklyColKey = {} as { string: string }
                  weeklyColKey[gasDayISOEachDay] = weeklyColKeyEachDay;
                }
              }
            }
          }
        }
        if (!isDaily && !weeklyColKey) continue;

        for (const row of rows) {
          const unit = this.utils.toUpper(row['9']);
          if (unit !== 'MMBTU/D') { continue; }

          // point id or concept fallback
          const point = [row['3'], row['5']].map((v: any) => (v ?? '').toString().trim()).find((v: string) => v.length > 0);
          if (!point) continue;

          // classify NOM → NONTPA → CONCEPT
          let base: any | null = null;
          const nm = nomMap.get(point);
          const nt = nonTpaMap.get(point);
          const zone = this.utils.toUpper(row['0']) ?? null;
          if (nm) {
            const allowed = contractCPs.get(ctr.contract_code) ?? new Set<string>();
            const cp = (nm.cpList ?? []).find((x: string) => allowed.has(x)) ?? null;
            const entryExit = (nm.entry_exit ?? row['10'])?.toString().toUpperCase() ?? null;
            if (!cp) { continue; }
            base = {
              point, point_type: 'NOM', customer_type: nm.customer_type ?? null,
              relation_point: cp, relation_point_type: cp ? 'CONTRACT' : null,
              area: nm.area ?? (row['2'] ?? null), zone: nm.zone ?? (row['0'] ?? null),
              entry_exit: entryExit
            };
          }
          else if (nt) {
            const entryExit = (nt.entry_exit ?? row['10'])?.toString().toUpperCase() ?? null;
            base = {
              point, point_type: 'NONTPA', customer_type: null,
              relation_point: nt.base_point, relation_point_type: 'NOM',
              area: nt.area ?? (row['2'] ?? null), zone: nt.zone ?? (this.utils.toUpper(row['0']) ?? null),
              entry_exit: entryExit
            };
          }
          else if (zone) {
            base = {
              point, point_type: 'CONCEPT', customer_type: null,
              relation_point: null, relation_point_type: null,
              area: row['2'] ?? null, zone: zone,
              entry_exit: null
            };
          }
          if (!base) continue;

          if (isDaily) {
            // DAILY: per-hour columns. Read column for each hour and push that hour's value (as-is)
            for (let h = buildFrom; h <= buildTo; h++) {
              const colKeyH = this.utils.resolveColumnKey(head, gasDayISO, true, { mode: 'INTRADAY', gasHour: h });
              if (!colKeyH) continue;
              const vH = this.utils.asNumber(row[colKeyH]);
              if (vH == null || Number.isNaN(vH)) continue;
              pushHour(gasDayISO, h, ctr.contract_code, ctr.group?.id_name as any, { ...base, value: vH }, true);
            }

          } else {
            // WEEKLY: one per-day value → split evenly by 24
            Object.keys(weeklyColKey).map(gasDayISOEachDay => {
              const weeklyColKeyEachDay = weeklyColKey[gasDayISOEachDay]
              const v = this.utils.asNumber(row[weeklyColKeyEachDay!]);
              if (v == null || Number.isNaN(v)) return;
              const hourlyValue = v / 24;
              for (let h = buildFrom; h <= buildTo; h++) {
                pushHour(gasDayISOEachDay, h, ctr.contract_code, ctr.group?.id_name as any, { ...base, value: hourlyValue }, false);
              }
            })
          }
        }
      }
    }
    // Adjustment series (shipper+point → [{minute, valueH}...])
    const shipperPointAdj = new Map<string, AdjEvent[]>();
    const has = (x: any) => x !== null && x !== undefined;


    for (const adj of (dailyAdjust ?? [])) {
      // daily_adjustment_group is an array
      const shipperNames = Array.from(
        new Set(
          (adj.daily_adjustment_group ?? [])
            .map((g: any) => g?.group?.id_name)
            .filter(Boolean)
        )
      ) as string[];

      if (shipperNames.length === 0) continue;

      const [hh, mm] = (adj.time || '00:00').split(':').map((n: any) => +n || 0);
      const minute = hh * 60 + mm;

      for (const item of (adj.daily_adjustment_nom ?? [])) {
        const point = item.nomination_point?.nomination_point;
        if (!point) continue;

        const perDay = item.valume_mmscfd2;   // MMBTU/D
        const perHour = item.valume_mmscfh2;  // MMBTU/H

        let valueH: number | null = null;
        if (has(perHour) && !has(perDay)) valueH = Number(perHour);
        else if (!has(perHour) && has(perDay)) valueH = Number(perDay) / 24;
        else if (has(perHour) && has(perDay)) valueH = Number(perHour);
        else continue;

        if (Number.isNaN(valueH)) continue;

        // add for each shipper in the group list
        for (const shipper of shipperNames) {
          const key = `${adj.daily_code}|${shipper}|${point}`;
          const arr = shipperPointAdj.get(key) ?? [];
          arr.push({ minute, valueH });
          shipperPointAdj.set(key, arr);

          // 🔎 Add logging here
          console.log(`[nom_intraday:debug] key = ${key}`);
          console.log(`[nom_intraday:debug] arr =`, arr); // prints the array contents
          console.log(`[nom_intraday:debug] arr.length = ${arr.length}`); // optional size check
        }

      }
    }
    for (const arr of shipperPointAdj.values()) arr.sort((a, b) => a.minute - b.minute);
    let adjPairs = 0, adjEvents = 0;
    for (const [k, arr] of shipperPointAdj.entries()) { adjPairs++; adjEvents += arr.length; }
    console.log('[nom_intra:debug] adjustments', { adjPairs, adjEvents });


    // Index baseline for prorating 
    const hasAdjKey = new Set<string>(Array.from(shipperPointAdj.keys()));
    console.log('[nom_intra:debug] hasAdjKey.size =', hasAdjKey.size);

    const adjKeySample = Array.from(hasAdjKey).slice(0, 5);
    console.log('[nom_intra:debug] hasAdjKey sample (raw):', adjKeySample);

    const uniqueAdjCodes = new Set<string>();
    for (const key of hasAdjKey) { // `${adjCode}|${shipper}|${point}`
      const [adjCode] = key.split('|');
      uniqueAdjCodes.add(adjCode);
    }

    // NEW: a quick lookup to know if any adj exists for (shipper,point)
    const hasAdjForSP = new Set<string>(); // `${shipper}|${point}`
    for (const key of hasAdjKey) {
      const [, shipper, point] = key.split('|');
      hasAdjForSP.add(`${shipper}|${point}`);
    }

    let totalRecords = 0;
    let baseIndexMembers = 0;
    type Member = {
      shipper: string;
      contract: string;
      rec: any;
    }[];

    // CHANGED: baseIndex key no longer has adjCode
    const baseIndex = new Map<string, { total: number; members: Member }>(); // key: gas_day|gas_hour|shipper|point

    for (const g of groups.values()) {
      totalRecords += g.data.length;
      const { gas_day, gas_hour, shipper } = g;

      for (const rec of g.data) {
        // Only index records that have ANY adjustment for this shipper+point (across adjCodes)
        if (!hasAdjForSP.has(`${shipper}|${rec.point}`)) continue;

        // CHANGED: no adjCode in the key
        const key = `${gas_day}|${gas_hour}|${shipper}|${rec.point}`;
        const slot = baseIndex.get(key) ?? { total: 0, members: [] };

        slot.total += Number(rec.value) || 0;
        slot.members.push({ shipper, contract: g.contract, rec });
        baseIndex.set(key, slot);
        baseIndexMembers++;
      }
    }


    console.log('[nom_intra:debug] groups', { buckets: groups.size, totalRecords });
    console.log('[nom_intra:debug] baseIndex', { keys: baseIndex.size, members: baseIndexMembers });
    if (groups.size === 0) {
      console.log('[nom_intra:debug] WARN: no groups built — quick reasons?', {
        contracts: contracts?.length ?? 0,
        filesMapKeys: contracts?.length ? contracts.map(c => filesMap.get(c.id)?.length ?? 0) : [],
        hasNomMap: nomDam && nomDam.length > 0,
        hasNonTpaMap: nonTpaDam && nonTpaDam.length > 0,
      });
    }

    // Compute shipper-hour targets (piecewise inside hour)
    const deviders = new Map<string, number>();
    const dayShipperPoints = new Map<string, Set<string>>();
    for (const g of groups.values()) {
      const k = `${g.gas_day}|${g.shipper}`;
      const set = dayShipperPoints.get(k) ?? new Set<string>();
      for (const rec of g.data) set.add(rec.point);
      dayShipperPoints.set(k, set);
    }

    // We’ll iterate hours and collect (gas_day, point, shippers) from baseIndex
    const orderedAdjCodes = Array.from(uniqueAdjCodes); // ensure order ADJ1 -> ADJ2 -> ...

    // Group baseIndex by (day|hour|point) → shippers
    const byHourPoint = new Map<string, Set<string>>(); // `${day}|${hour}|${point}` -> set(shipper)
    for (const [k] of baseIndex.entries()) {
      const [day, hourStr, shipper, point] = k.split('|');
      const hour = Number(hourStr);
      if (hour < buildFrom || hour > buildTo) continue;
      const hp = `${day}|${hour}|${point}`;
      if (!byHourPoint.has(hp)) byHourPoint.set(hp, new Set());
      byHourPoint.get(hp)!.add(shipper);
    }

    return {
      byHourPoint,
      orderedAdjCodes,
      hasAdjKey,
      baseIndex,
      deviders,
      shipperPointAdj,
      groups
    }
  }

  async daily_adjustment_summary(payload: any): Promise<{ gas_day: string; gas_hour: number; contract: string; shipper: string; data: any[] }[]> {
    const { byHourPoint, orderedAdjCodes, hasAdjKey, baseIndex, deviders, shipperPointAdj, groups } = await this.prepare_daily_adjustment_data(payload);
    const { gas_day } = payload;
    const targets = new Map<string, number>(); // gas_day|hour|point -> valueH

    // console.log('prorate adjust to hour')
    // for (const [gsKey, points] of dayShipperPoints.entries()) {
    //   for (const adjCode of uniqueAdjCodes) {
    //     const [gas_day, shipper] = gsKey.split('|');
    //     for (const point of points) {
    //       if (!hasAdjKey.has(`${adjCode}|${shipper}|${point}`)) { continue; };
    //       const adjKey = `${adjCode}|${shipper}|${point}`
    //       const series = shipperPointAdj.get(adjKey) || [];
    //       console.log(`[nom_intra:debug] ${adjKey}`);
    //       console.log(`[nom_intra:debug] `, series);

    //       for (let hour = buildFrom; hour <= buildTo; hour++) {
    //         const startMin = (hour - 1) * 60; const endMin = hour * 60;
    //         const lastBefore = [...series].filter((a: any) => a.minute < startMin).pop();
    //         const baseKey = `${gas_day}|${hour}|${adjCode}|${shipper}|${point}`;
    //         const slot = baseIndex.get(baseKey) ?? { total: 0, members: [] };
    //         let base = slot.total || 0;
    //         let current = lastBefore ? lastBefore.valueH : base;
    //         let devider = deviders.get(`${gas_day}|${hour}|${adjCode}|${point}`) || 0;

    //         let sum = 0, cursor = startMin;
    //         const inHour = series.filter((a: any) => a.minute >= startMin && a.minute < endMin);
    //         if (inHour.length >= 1) { devider += current; }
    //         else { devider = deviders.get(`${gas_day}|${hour - 1}|${adjCode}|${point}`) || 0; }
    //         console.log(`[nom_intra:deubg] process hour ${hour}`)
    //         for (const a of inHour) {
    //           if (a.minute > cursor) {
    //             console.log(`[nom_intra:deubg] a.minute > cursor: ${sum} + ${current} * (${a.minute} - ${cursor})`);
    //             sum += current * (a.minute - cursor);
    //             // update base
    //             if (cursor === startMin) {
    //               slot.total = sum / 60;
    //               baseIndex.set(baseKey, slot);
    //             }
    //           }
    //           current = a.valueH;
    //           cursor = a.minute;
    //           console.log(`[nom_intra:deubg] update current = ${current} cursor = ${cursor}`);
    //         }
    //         if (endMin > cursor) {
    //           // cal target
    //           console.log(`[nom_intra:deubg] endMin > cursor ${sum} + ${current} * (${endMin} - ${cursor})`);
    //           sum += current * (endMin - cursor);
    //         }
    //         let target = sum / 60
    //         console.log(`[nom_intra:deubg] devider = ${devider}`)
    //         console.log(`[nom_intra:deubg] target = ${target}`)
    //         deviders.set(`${gas_day}|${hour}|${adjCode}|${point}`, devider);
    //         const targetKey = `${gas_day}|${hour}|${adjCode}|${shipper}|${point}`;
    //         targets.set(targetKey, target);

    //         // update base
    //         if (inHour.length === 0) { slot.total = 0; baseIndex.set(baseKey, slot); }

    //       }
    //     }
    //   }
    // }
    // console.log('[nom_intra:debug] targets.size =', targets.size);

    // Prorate

    // --- add these 2 helpers & 2 maps just ABOVE "console.log('prorate adjust to contract')" ---

    console.log('prorate adjust to contract');

    // Helper key builders
    const spKey = (day: string, hour: number, shipper: string, point: string) =>
      `${day}|${hour}|${shipper}|${point}`;
    const adjDivKey = (day: string, hour: number, adjCode: string, point: string) =>
      `${day}|${hour}|${adjCode}|${point}`;
    const targetKeyOf = (day: string, hour: number, adjCode: string, shipper: string, point: string) =>
      `${day}|${hour}|${adjCode}|${shipper}|${point}`;
    const baseKeyOf = (day: string, hour: number, shipper: string, point: string) =>
      `${day}|${hour}|${shipper}|${point}`;

    // Now process per (day,hour,point), adj by adj
    for (const [hp, shippers] of byHourPoint.entries()) {
      const [day, hourStr, point] = hp.split('|');
      const hour = Number(hourStr);

      for (const adjCode of orderedAdjCodes) {
        // Which shippers at this point have this adj?
        const participants = Array.from(shippers).filter(s => hasAdjKey.has(`${adjCode}|${s}|${point}`));
        if (participants.length === 0) {
          // console.log(`[nom_intra:debug] skipped no shipper found for ${adjCode}`);
          continue;
        }

        // 1) Build divider for THIS adj from current bases (shared baseIndex)
        let divider = 0;
        for (const shipper of participants) {
          const slot = baseIndex.get(spKey(day, hour, shipper, point)) ?? { total: 0, members: [] };
          divider += Number(slot.total) || 0;
        }
        deviders.set(adjDivKey(day, hour, adjCode, point), divider);

        // 2) Compute target & prorate per shipper
        for (const shipper of participants) {
          const keySP = spKey(day, hour, shipper, point);
          const slot = baseIndex.get(keySP) ?? { total: 0, members: [] };
          let base = Number(slot.total) || 0;

          const seriesAdj = shipperPointAdj.get(`${adjCode}|${shipper}|${point}`) || [];
          const startMin = (hour - 1) * 60;
          const endMin = hour * 60;
          const lastBefore = [...seriesAdj].filter((a: any) => a.minute < startMin).pop();
          let current = lastBefore ? lastBefore.valueH : base;

          const inHour = seriesAdj.filter((a: any) => a.minute >= startMin && a.minute < endMin);

          console.log(`[nom_intra:debug] proccess adjustment ${gas_day}, ${hour}, ${point}, ${adjCode}, ${shipper}`)
          let target: number;
          let sum = 0, cursor = startMin;
          let firstSegmentBaseApplied = false;

          for (const a of inHour) {
            if (a.minute > cursor) {
              const before = sum;
              sum += current * (a.minute - cursor);
              // set base from the *first* segment only
              if (!firstSegmentBaseApplied) {
                const baseHour = sum / 60;
                base = baseHour;
                firstSegmentBaseApplied = true;
                console.log(`[nom_intrad:debug] base(first-seg) = ${before} + ${current} * (${a.minute} - ${cursor}) => sum=${sum}; base=${baseHour}`);
              } else {
                console.log(`[nom_intrad:debug] adjust: ${before} += ${current} * (${a.minute} - ${cursor}) => ${sum}`);
              }
            }
            current = a.valueH;
            cursor = a.minute;
          }

          console.log(`[nom_intrad:debug] target: ${sum} + ${current} * (${endMin} - ${cursor})`);
          if (endMin > cursor) {
            sum += current * (endMin - cursor);
          }
          target = sum / 60;

          // Save target (for your later “same target skip” logic if you need it)
          targets.set(targetKeyOf(day, hour, adjCode, shipper, point), target);

          // Prorate to contracts using *this adj's* divider and current base
          const members = slot.members || [];
          const shValue = members.reduce((s, m) => s + (Number(m.rec.value) || 0), 0);
          let adjust = target - base;

          console.log(`[nom_intrad:debug] target = ${target}`);
          console.log(`[nom_intrad:debug] base = ${base}`);
          console.log(`[nom_intrad:debug] members.length = ${members.length} `);
          const prv_target = targets.get(targetKeyOf(day, hour - 1, adjCode, shipper, point)) || 0;
          if (target === prv_target && prv_target !== 0) {
            console.log(`[nom_intra:debug] skip prorate to contact because same target`);
            const prv_slot = baseIndex.get(baseKeyOf(day, hour - 1, shipper, point));
            const prv_member = prv_slot.members;
            slot.total = prv_slot.total;
            for (let i = 0; i < members.length; i++) {
              members[i].rec.value = prv_member[i].rec.value;
              console.log(`${members[i].contract} = ${members[i].rec.value}`)
            }
          }
          else if (Math.abs(adjust) > 0 && members.length > 0 && shValue !== 0 && divider !== 0) {
            slot.total = 0;
            if (inHour.length === 0) {
              adjust += base;
              base = 0;
            }
            for (const m of members) {
              const value = Number(m.rec.value) || 0;
              m.rec.value = this.utils.round3(
                base * (value / shValue) + adjust * (value / divider)
              );
              slot.total += m.rec.value;
              console.log(`[nom_intra:debug] ${m.contract}: ${base} * (${value} / ${shValue}) + ${adjust} * (${value} / ${divider})  = ${m.rec.value}`)
            }
          }

          // **WRITE BACK the new base for this shipper** so the next adj sees it
          baseIndex.set(keySP, slot);
        }
      }
    }


    // Cumulative and response (round final values to 3 decimals)
    const sorted = Array.from(groups.values()).sort(
      (a, b) => a.gas_day.localeCompare(b.gas_day) ||
        a.contract.localeCompare(b.contract) ||
        a.shipper.localeCompare(b.shipper) ||
        a.gas_hour - b.gas_hour
    );

    return sorted
  }

  async eviden_nomination_intraday(payload: any) {
    const { gas_day, start_hour, end_hour, skip, limit } = payload;
    const { fromH, toH } = this.utils.normalizeHourWindow(start_hour, end_hour);

    const reqFrom = Math.max(1, fromH ?? 1);
    const reqTo = Math.min(24, toH ?? 24)

    const sorted = await this.daily_adjustment_summary(payload);

    const cum = new Map<string, number>();
    for (const g of sorted) {
      for (const rec of g.data) {
        const k = `${g.gas_day}|${g.contract}|${g.shipper}|${rec.point}${rec.zone}`;
        const prev = cum.get(k) ?? 0;
        const next = prev + (Number(rec.value) || 0);
        rec.value = this.utils.round3(next); // final values rounded to 3 decimals
        cum.set(k, next);
      }
    }

    const filtered = sorted.filter(g => g.gas_hour >= reqFrom && g.gas_hour <= reqTo);
    const data = this.utils.paginate(filtered, skip, limit);
    return { total_record: data.length, status_code: 200, data };
  }
}
