import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { getTodayNow } from 'src/common/utils/date.util';

export type PushMode = 'DAILY_OVERRIDES_WEEKLY' | 'CONCEPT_SUMS';

export interface HourWindow { fromH: number; toH: number; }
export interface MergeItem {
    point: string | number;
    point_type: string; // e.g. 'CONCEPT'
    value?: number | string | null;
    [k: string]: unknown;
}

@Injectable()
export class AstosUtils {
    safeParse<T extends object = Record<string, any>>(s: unknown): T {
        if (!s) return {} as T;
        try {
            if (typeof s === 'string') return JSON.parse(s) as T;
            if (s && typeof s === 'object') return s as T;
            return {} as T;
        } catch (e) {
            console.error('safeParse JSON error:', e);
            return {} as T;
        }
    }

    toUpper(v: unknown): string | null {
        return v == null ? null : String(v).toUpperCase();
    }

    asNumber(v: any): number | null {
        if (v == null) return null;
        const s = String(v).replace(/,/g, '').trim();
        if (s === '') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }


    resolveColumnKey(
        head: Record<string, unknown> | null | undefined,
        gasDayISO: string,
        isDaily: boolean,
        opts?: { mode?: 'EOD' | 'INTRADAY'; gasHour?: number }
    ): string | null {
        const entries = Object.entries(head || {});
        if (entries.length === 0) return null;

        const mode = opts?.mode ?? 'EOD';

        // Intraday + Daily → pick the column for the specific hour
        if (isDaily && mode === 'INTRADAY') {
            const h = Number(opts?.gasHour ?? 0);
            if (!(h >= 1 && h <= 24)) return null;

            const patt = [
                new RegExp(`^(?:HOUR|HR|H)\\s*0?${h}$`, 'i'),            // "Hour 1", "H1", "HR01"
                new RegExp(`^0?${h}(?::00)?$`, 'i'),                     // "1", "01", "01:00"
                new RegExp(`^0?${h}[\\.:]00$`, 'i'),                     // "01.00"
            ];

            const found = entries.find(([, label]) => {
                const s = String(label ?? '').trim();
                return patt.some(rx => rx.test(s));
            });

            return found ? (found[0] as string) : null;
        }

        // EOD behavior (unchanged)
        if (isDaily && mode === 'EOD') {
            const found = entries.find(([, label]) => String(label).trim().toUpperCase() === 'TOTAL');
            return found ? (found[0] as string) : null;
        }

        // Weekly → use the gas day label
        const gasDayText = getTodayNow(gasDayISO).format('DD/MM/YYYY');
        const found = entries.find(([, label]) => String(label).trim() === gasDayText);
        return found ? (found[0] as string) : null;
    }

    expandGasDays(startISO: string, endISO: string): string[] {
        const start = dayjs(startISO);
        const end = dayjs(endISO);
        const days: string[] = [];
        for (let d = start.clone(); d.isSameOrBefore(end); d = d.add(1, 'day')) {
            days.push(d.format('YYYY-MM-DD'));
        }
        return days;
    }

    normalizeHourWindow(startHour: unknown, endHour: unknown): HourWindow {
        const fromH = Math.max(1, Math.min(24, Number(startHour) || 1));
        const toH = Math.max(fromH, Math.min(24, Number(endHour) || 24));
        return { fromH, toH };
    }

    insertOrMerge<T extends MergeItem>(
        bucket: T[],
        item: T,
        mode: PushMode = 'DAILY_OVERRIDES_WEEKLY',
        isDaily = true,
    ): void {
        const idx = bucket.findIndex(d => d.point === item.point && d.point_type === item.point_type && d.zone === item.zone);
        if (idx === -1) { bucket.push(item); return; }

        if (item.point_type === 'CONCEPT' && mode === 'CONCEPT_SUMS') {
            const prev = this.asNumber(bucket[idx].value);
            const curr = this.asNumber(item.value);
            bucket[idx].value = (prev || 0) + (curr || 0);
        } else if (mode === 'DAILY_OVERRIDES_WEEKLY' && isDaily) {
            bucket[idx] = item;
        }
    }

    paginate<T>(arr: T[], skip?: number, limit?: number): T[] {
        if ((Number(skip) || 0) === 0 && (Number(limit) || 0) === 0) return arr;
        const s = Number(skip) || 0;
        const l = Number(limit) || 0;
        return l > 0 ? arr.slice(s, s + l) : arr.slice(s);
    }

    round3 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}
