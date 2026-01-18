import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { getTodayNowAdd7, getWeekRange } from 'src/common/utils/date.util';
import dayjs from 'dayjs';

// Narrow shapes used by service
export interface ContractLite { id: number; contract_code: string; group?: { id_name: string | null } | null }
export interface NomFileVersionLite { data_temp: any }
export interface NomFileLite {
    id: number;
    gas_day: Date;
    nomination_type: { name: string } | null;
    nomination_version: { nomination_full_json: NomFileVersionLite[] }[];
}

export interface AdjEvent { minute: number; valueH: number }

@Injectable()
export class AstosRepository {
    constructor(private readonly prisma: PrismaService) { }

    // ===== Common lookups =====
    async getDamConceptPoints(start: Date, end: Date): Promise<
        {
            concept_point: string;
            limit_concept_point: { group: { id_name: string } }[];
        }[]
    > {
        return this.prisma.concept_point.findMany({
            where: {
                AND: [
                    { OR: [{ end_date: { gte: start } }, { end_date: null }] },
                    { start_date: { lte: end } },
                    { type_concept_point: { name: { in: ['Nomination Physical gas concepts', 'Other (area/zone) concepts'] } } }
                ]
            },
            select: {
                concept_point: true,
                limit_concept_point: {
                    select: { group: { select: { id_name: true } } }
                }
            }
        });
    }

    async getDamNonTpaPoints(start: Date, end: Date) {
        return this.prisma.non_tpa_point.findMany({
            where: {
                AND: [
                    { OR: [{ end_date: { gte: start } }, { end_date: null }] },
                    { start_date: { lte: end } },
                ],
            },
            select: {
                id: true,
                non_tpa_point_name: true,
                nomination_point: {
                    select: {
                        nomination_point: true,
                        entry_exit: { select: { name: true } },
                        zone: { select: { name: true } },
                        area: { select: { name: true } },
                    },
                },
            },
        });
    }

    async getDamNomPoints(start: Date, end: Date) {
        return this.prisma.nomination_point.findMany({
            where: {
                AND: [
                    { OR: [{ end_date: { gte: start } }, { end_date: null }] },
                    { start_date: { lte: end } },
                ],
            },
            select: {
                nomination_point: true,
                entry_exit: { select: { name: true } },
                zone: { select: { name: true } },
                area: { select: { name: true } },
                customer_type: { select: { name: true } },
                contract_point_list: { select: { contract_point: true } }, // M:N
            },
        });
    }

    async getContractsInRange(start: Date, end: Date): Promise<ContractLite[]> {
        const { weekStart: targetWeekStart } = getWeekRange(start);
        const { weekEnd: targetWeekEnd } = getWeekRange(end);
        return this.prisma.contract_code.findMany({
            where: {
                contract_end_date: { gte: start },
                contract_start_date: { lte: end },
                query_shipper_nomination_file: {
                    some: {
                        AND: [
                            {
                                OR: [
                                    {
                                        nomination_type_id: 1,
                                        gas_day: { gte: start, lte: end },
                                    },
                                    {
                                        AND: [
                                            {
                                                nomination_type_id: 2,
                                                gas_day: { gte: targetWeekStart, lte: targetWeekEnd },
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                query_shipper_nomination_status: { name: { in: ['Approved by System', 'Approved'] } },
                            },
                            {
                                OR: [{ del_flag: false }, { del_flag: null }],
                            },
                            {
                                nomination_version: { some: { flag_use: true } },
                            }
                        ]
                    },
                },
            },
            select: { id: true, contract_code: true, group: { select: { id_name: true } } },
        });
    }

    /**
     * Return Daily files; where Daily missing for a (contract, day) fallback to Weekly.
     * Yields a map: contractId -> files[] sorted (gas_day asc, id desc)
     */
    async getPreferredNomFiles(contractIds: number[], start: Date, end: Date) {
        if (!contractIds.length) return new Map<number, NomFileLite[]>();

        const { weekStart: targetWeekStart } = getWeekRange(start);
        const { weekEnd: targetWeekEnd } = getWeekRange(end);

        const base: Prisma.query_shipper_nomination_fileWhereInput = {
            query_shipper_nomination_status: { name: { in: ['Approved by System', 'Approved'] } },
            OR: ([{ del_flag: false }, { del_flag: null }] as Prisma.query_shipper_nomination_fileWhereInput[]),
            nomination_version: { some: { flag_use: true } },
            contract_code_id: { in: contractIds },
        };

        const daily = await this.prisma.query_shipper_nomination_file.findMany({
            where: { ...base, nomination_type: { name: 'Daily' }, gas_day: { gte: start, lte: end }, },
            select: {
                id: true, gas_day: true, contract_code_id: true,
                nomination_type: { select: { name: true } },
                nomination_version: {
                    where: { flag_use: true }, orderBy: { id: 'desc' }, take: 1,
                    select: { nomination_full_json: { select: { data_temp: true } } },
                },
            },
            orderBy: [{ gas_day: 'asc' }, { id: 'desc' }],
        });

        const dailyKey = new Set<string>();
        for (const f of daily) dailyKey.add(`${f.contract_code_id}|${+new Date(f.gas_day)}`);

        const weeklyAll = await this.prisma.query_shipper_nomination_file.findMany({
            where: { ...base, nomination_type: { name: 'Weekly' }, gas_day: { gte: targetWeekStart, lte: targetWeekEnd }, },
            select: {
                id: true, gas_day: true, contract_code_id: true,
                nomination_type: { select: { name: true } },
                nomination_version: {
                    where: { flag_use: true }, orderBy: { id: 'desc' }, take: 1,
                    select: { nomination_full_json: { select: { data_temp: true } } },
                },
            },
            orderBy: [{ gas_day: 'asc' }, { id: 'desc' }],
        });

        const weekly = weeklyAll.filter((f) => {
            const gasDay = getTodayNowAdd7(f.gas_day)
            const allKeyInWeek: string[] = []
            let i = 0
            do {
                const dateInWeek = gasDay.add(i, 'day')
                allKeyInWeek.push(`${f.contract_code_id}|${+new Date(dateInWeek.toDate())}`)
                i++
            } while (i < 7);
            return allKeyInWeek.filter((key) => dailyKey.has(key)).length != allKeyInWeek.length
        });

        const map = new Map<number, NomFileLite[]>();
        for (const id of contractIds) map.set(id, []);
        for (const f of daily) map.get((f as any).contract_code_id)!.push(f as any);
        for (const f of weekly) map.get((f as any).contract_code_id)!.push(f as any);

        for (const [, arr] of map) arr.sort((a: any, b: any) => {
            const ga = +new Date(a.gas_day), gb = +new Date(b.gas_day);
            if (ga !== gb) return ga - gb; // day asc
            return b.id - a.id;            // id desc
        });

        return map;
    }

    async getContractAllowedCPs(contractCodes: string[]) {
        if (!contractCodes?.length) return new Map<string, Set<string>>();
        const uniq = Array.from(new Set(contractCodes));
        const rows = await this.prisma.contract_code.findMany({
            where: { contract_code: { in: uniq } },
            select: {
                contract_code: true,
                booking_version: {
                    orderBy: { id: 'desc' }, take: 1,
                    select: { booking_row_json: { select: { contract_point: true } } },
                },
            },
        });
        const out = new Map<string, Set<string>>();
        for (const r of rows) {
            const cps = (r.booking_version?.[0]?.booking_row_json ?? [])
                .map((x: any) => x.contract_point)
                .filter(Boolean);
            out.set(r.contract_code, new Set(cps));
        }
        return out;
    }

    async getDailyAdjustments(gasDay: Date) {
        return this.prisma.daily_adjustment.findMany({
            orderBy: { create_date: 'asc' },
            where: { gas_day: gasDay, daily_adjustment_status: { name: 'Approved' } },
            select: {
                id: true, create_date: true, gas_day: true, time: true, daily_code: true,
                daily_adjustment_group: { select: { group: { select: { id_name: true } } } },
                daily_adjustment_nom: {
                    select: {
                        valume_mmscfd2: true, // per-day
                        valume_mmscfh2: true, // per-hour
                        nomination_point: { select: { nomination_point: true } },
                    },
                },
            },
        });
    }

    async getAllocationModes(until: Date) {
        return this.prisma.allocation_mode.findMany({
            where: { start_date: { lte: until } },
            orderBy: { start_date: 'asc' },
            select: { start_date: true, allocation_mode_type: { select: { mode: true } } },
        });
    }

    // ===== Execute EOD/Intraday status =====
    async findExecuteEod(where: { request_number_id: any; execute_timestamp: any }) {
        return await this.prisma.execute_eod.findFirst({ where });
    }
    async updateExecuteEod(where: { request_number_id: any; execute_timestamp: any }, data: any) {
        return await this.prisma.execute_eod.updateMany({ where, data });
    }

    async updateReviewStatus(eodExeTime?: number) {
        try {
            console.log(`[DEBUG] update review start,  for ${eodExeTime}`);
            const now = getTodayNowAdd7();
            console.log(`[DEBUG] check process loss 1`);
            let refEod: { execute_timestamp: number } | null = null;

            console.log(`[DEBUG] check process loss 2`);
            refEod = await this.prisma.execute_eod.findFirst({
                select: { execute_timestamp: true },
                where: { status: 'OK', execute_timestamp: { lt: eodExeTime } },
                orderBy: { execute_timestamp: 'desc' },
            });

            console.log(`[DEBUG] check process loss 3`);
            if (!refEod) {
                console.log(
                    `[DEBUG] update review skipped: no reference OK EOD found (eodExeTime=${eodExeTime})`,
                );
                return;
            }


            // 2) Lookup status IDs
            console.log(`[DEBUG] check process loss 4`);
            const [accepted, allocated] = await this.prisma.$transaction([
                this.prisma.allocation_status.findFirst({
                    where: { name: 'Accepted' },
                    select: { id: true },
                }),
                this.prisma.allocation_status.findFirst({
                    where: { name: 'Allocated' },
                    select: { id: true },
                }),
            ]);
            console.log(`[DEBUG] accepted=${accepted?.id}, allocated=${allocated?.id}`);

            console.log(`[DEBUG] check process loss 5`);
            if (!accepted?.id || !allocated?.id) {
                throw new Error('Status "Accepted" or "Allocated" not found');
            }

            // 3) Prepare timestamps
            console.log(`[DEBUG] check process loss 6`);
            const update_date = now.toDate();
            const update_date_num = now.unix(); // seconds int

            console.log(`[DEBUG] check process loss 7`);
            // 4) Update both tables in one transaction + log counts
            const [u1, u2] = await this.prisma.$transaction([
                this.prisma.allocation_management.updateMany({
                    where: {
                        allocation_status_id: accepted.id,
                        update_date_num: { gte: refEod.execute_timestamp },
                    },
                    data: {
                        allocation_status_id: allocated.id,
                        update_date,
                        update_date_num,
                    },
                }),
                this.prisma.allocation_management_shipper_review.updateMany({
                    where: {
                        allocation_status_id: accepted.id,
                        update_date_num: { gte: refEod.execute_timestamp },
                    },
                    data: {
                        allocation_status_id: allocated.id,
                        update_date,
                        update_date_num,
                    },
                }),
            ]);

            console.log(
                `[DEBUG] review updates done: allocation_management.count=${u1.count}, shipper_review.count=${u2.count}`,
            );
        } catch (err: any) {
            console.error('[ERROR] updateReviewStatus failed:', err?.stack || err);
            throw err; // let caller handle response
        }
    }



    findExecuteIntraday(where: { request_number_id: any; execute_timestamp: any }) {
        return this.prisma.execute_intraday.findFirst({ where });
    }
    updateExecuteIntraday(where: { request_number_id: any; execute_timestamp: any }, data: any) {
        return this.prisma.execute_intraday.updateMany({ where, data });
    }

    // ===== Notification recipients =====
    async getInAppNotiRecipients(menuId = 82) {
        return this.prisma.account.findMany({
            where: {
                id: { not: 99999 },
                account_manage: {
                    some: {
                        account_role: {
                            some: {
                                role: {
                                    menus_config: { some: { menus_id: menuId, f_noti_inapp: 1 } },
                                },
                            },
                        },
                    },
                },
            },
            select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
                telephone: true,
                account_manage: { include: { account_role: { include: { role: true } } } },
            },
            orderBy: { id: 'asc' },
        });
    }

    // ===== Evidence queries moved from service =====
    async findContractsForEvidence(start_date: Date, end_date: Date) {
        // Keep this object 'as const' so Prisma can infer the payload type
        const args = {
            orderBy: { id: 'desc' },
            where: {
                contract_end_date: { gt: start_date },
                contract_start_date: { lte: end_date },
            },
            select: {
                id: true,
                contract_code: true,
                group: { select: { id_name: true } },
                booking_version: {
                    where: {
                        flag_use: true,
                        status_capacity_request_management: { name: 'Approved' },
                    },
                    select: {
                        booking_full_json: { select: { data_temp: true } },
                        booking_row_json: {
                            select: {
                                zone_text: true,
                                area_text: true,
                                contract_point: true,
                                entry_exit_id: true,
                                data_temp: true,
                            },
                        },
                        booking_row_json_release: {
                            select: {
                                zone_text: true,
                                area_text: true,
                                contract_point: true,
                                entry_exit_id: true,
                                data_temp: true,
                            },
                        },
                    },
                    orderBy: { id: 'desc' },
                },
            },
        } as const; // <-- important

        // Derive the precise row type from args
        type Row = Prisma.contract_codeGetPayload<typeof args>;

        // Prisma will actually infer this return type automatically thanks to 'as const',
        // but adding the explicit annotation keeps TS happy in callers.
        const rows = await this.prisma.contract_code.findMany(args);
        return rows as Row[]; // (optional cast, helps some TS configs)
    }
}