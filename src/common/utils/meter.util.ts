import { isMatch } from './allcation.util';

/**
 * Status codes for rejected or cancelled nominations.
 */
export const REJECTED_OR_CANCELLED_STATUS = [3, 5];

export interface ActiveNominationFileParams {
    targetDate: Date;
    targetWeekStart: Date;
    targetWeekEnd: Date;
    prisma: any;
}

/**
 * Fetches active nomination files for a given date or week, including only the latest nomination_version where flag_use is not false.
 * @param params - The date and week range to filter nominations.
 * @returns A list of active nomination files with their latest valid version.
 */
export async function getActiveNominationFiles({
    targetDate,
    targetWeekStart,
    targetWeekEnd,
    prisma,
}: ActiveNominationFileParams) {
    return prisma.query_shipper_nomination_file.findMany({
        where: {
        AND: [
            {
            query_shipper_nomination_status: {
                id: { notIn: REJECTED_OR_CANCELLED_STATUS },
            },
            },
            {
            OR: [
                {
                nomination_type: { id: 1 },
                gas_day: targetDate,
                },
                {
                nomination_type: { id: 2 },
                gas_day: { gte: targetWeekStart, lte: targetWeekEnd },
                },
            ],
            },
        ],
        },
        include: {
        nomination_type: true,
        contract_code: { select: { contract_code: true } },
        query_shipper_nomination_status: { select: { name: true } },
        nomination_version: {
            where: { flag_use: { not: false } },
            orderBy: { create_date: 'desc' },
            take: 1,
            include: {
            nomination_full_json: {
                where: { flag_use: { not: false } },
                orderBy: { create_date: 'desc' },
                take: 1,
            },
            },
        },
        },
    });
}

/**
 * DRY utility to apply nomination values to missing metering points for both daily and weekly nominations.
 */
export function applyNominationValues({
    nominationFiles,
    missingGasPoints,
    data,
    gasDay,
    isWeekly = false,
    uniqueReplacedGasPoints = [],
    headData = null,
    gasDayKey = null,
}) {
    const replacedGasPoints : any[] = [];
    for (const file of nominationFiles) {
        const version = file.nomination_version?.[0];
        const fullJson = version?.nomination_full_json?.[0]?.data_temp;
        if (!fullJson) continue;
        const nominationFullJson = JSON.parse(fullJson);
        const valueData = nominationFullJson.valueData;
        if (!Array.isArray(valueData) || valueData.length === 0) continue;
        for (const value of valueData) {
            const zone = value['0'];
            const area = value['2'];
            const point = value['3'];
            const unit = value['9'];
            const entryExit = value['10'];
            // For weekly, check headData and gasDayKey
            let total = null;
            if (isWeekly && headData && gasDayKey) {
                const gasDayValue = value[gasDayKey];
                if (gasDayValue) {
                    total = Number(String(gasDayValue).trim().replace(/,/g, ''));
                }
            } else {
                total = Number(String(value['38']).trim().replace(/,/g, ''));
            }
            // Find matching missing points
            const meterPointInNominationPoint = missingGasPoints.filter(missingGasPoint =>
                missingGasPoint.nomination_point?.nomination_point == point &&
                isMatch(missingGasPoint.nomination_point?.zone?.name, zone) &&
                isMatch(missingGasPoint.nomination_point?.area?.name, area) &&
                isMatch(missingGasPoint.nomination_point?.entry_exit?.name, entryExit) &&
                (!isWeekly || !uniqueReplacedGasPoints.some(r => r.id == missingGasPoint.id))
            );
            if (meterPointInNominationPoint.length > 0) {
                const newMeterValue = Number.isNaN(total) ? null : (total / meterPointInNominationPoint.length);
                // --- DRY update logic ---
                const wobbeIndex = value['11'];
                const heatingValue = value['12'];
                const sg = value['13'];
                const newData = {
                meterPointId: point,
                gasDay: gasDay,
                value: {
                    meteringPointId: point,
                    datasource: 'Nomination',
                    energy: unit?.toUpperCase().includes('MMBTU') ? newMeterValue : null,
                    gasDay: gasDay,
                    registerTimestamp: '',
                    volume: unit?.toUpperCase().includes('MMSCFD') ? newMeterValue : null,
                    heatingValue: heatingValue,
                    wobbeIndex: wobbeIndex,
                    sg: sg,
                    data_temp: {},
                    measurements: {},
                    in_time: null,
                    insert_timestamp: null,
                    metering_retrieving_id: null,
                    rw: true
                }
                };
                const indexToUpdate = data.findIndex(meterData => meterData.meterPointId == point && meterData.gasDay == gasDay);
                if(indexToUpdate > -1){
                if(data[indexToUpdate].value && newMeterValue){
                    if(unit?.toUpperCase().includes('MMBTU')){
                        if(data[indexToUpdate].value.energy){
                            const energy = Number(data[indexToUpdate].value.energy);
                            if(!Number.isNaN(energy)){
                                data[indexToUpdate].value.energy = energy + newMeterValue;
                            }
                        } else {
                            data[indexToUpdate].value.energy = newMeterValue;
                        }
                    }
                    if(unit?.toUpperCase().includes('MMSCFD')){
                        if(data[indexToUpdate].value.volume){
                            const volume = Number(data[indexToUpdate].value.volume);
                            if(!Number.isNaN(volume)){
                                data[indexToUpdate].value.volume = volume + newMeterValue;
                            }
                        } else {
                            data[indexToUpdate].value.volume = newMeterValue;
                        }
                    }
                } else {
                    data[indexToUpdate].value = newData.value;
                }
                } else {
                data.push(newData);
                }
                replacedGasPoints.push(...meterPointInNominationPoint);
            }
        }
    }
    // Return unique replaced points
    return Array.from(new Map(replacedGasPoints.map(item => [item.id, item])).values());
}
export function applyNominationValuesToValueOnlyObject({
    nominationFiles,
    missingGasPoints,
    data,
    gasDay,
    isWeekly = false,
    uniqueReplacedGasPoints = [],
    headData = null,
    gasDayKey = null,
}) {
    const replacedGasPoints : any[] = [];
    for (const file of nominationFiles) {
        const version = file.nomination_version?.[0];
        const fullJson = version?.nomination_full_json?.[0]?.data_temp;
        if (!fullJson) continue;
        const nominationFullJson = JSON.parse(fullJson);
        const valueData = nominationFullJson.valueData;
        if (!Array.isArray(valueData) || valueData.length === 0) continue;
        for (const value of valueData) {
            const zone = value['0'];
            const area = value['2'];
            const point = value['3'];
            const unit = value['9'];
            const entryExit = value['10'];
            // For weekly, check headData and gasDayKey
            let total = null;
            if (isWeekly && headData && gasDayKey) {
                const gasDayValue = value[gasDayKey];
                if (gasDayValue) {
                total = Number(String(gasDayValue).trim().replace(/,/g, ''));
                }
            } else {
                total = Number(String(value['38']).trim().replace(/,/g, ''));
            }
            // Find matching missing points
            const meterPointInNominationPoint = missingGasPoints.filter(missingGasPoint =>
                missingGasPoint.nomination_point?.nomination_point == point &&
                isMatch(missingGasPoint.nomination_point?.zone?.name, zone) &&
                isMatch(missingGasPoint.nomination_point?.area?.name, area) &&
                isMatch(missingGasPoint.nomination_point?.entry_exit?.name, entryExit) &&
                (!isWeekly || !uniqueReplacedGasPoints.some(r => r.id == missingGasPoint.id))
            );
            if (meterPointInNominationPoint.length > 0) {
                const newMeterValue = Number.isNaN(total) ? null : (total / meterPointInNominationPoint.length);
                // --- DRY update logic ---
                const wobbeIndex = value['11'];
                const heatingValue = value['12'];
                const sg = value['13'];
                const newData = {
                    meteringPointId: point,
                    datasource: 'Nomination',
                    energy: unit?.toUpperCase().includes('MMBTU') ? newMeterValue : null,
                    gasDay: gasDay,
                    registerTimestamp: '',
                    volume: unit?.toUpperCase().includes('MMSCFD') ? newMeterValue : null,
                    heatingValue: heatingValue,
                    wobbeIndex: wobbeIndex,
                    sg: sg,
                    data_temp: {},
                    measurements: {},
                    in_time: null,
                    insert_timestamp: null,
                    metering_retrieving_id: null,
                    rw: true
                };
                const indexToUpdate = data.findIndex((meterData: any) => meterData.meteringPointId == point && meterData.gasDay == gasDay);
                if(indexToUpdate > -1){
                    if(data[indexToUpdate] && newMeterValue){
                        if(unit?.toUpperCase().includes('MMBTU')){
                            if(data[indexToUpdate].energy){
                                const energy = Number(data[indexToUpdate].energy);
                                if(!Number.isNaN(energy)){
                                    data[indexToUpdate].energy = energy + newMeterValue;
                                }
                            } else {
                                data[indexToUpdate].energy = newMeterValue;
                            }
                        }
                        if(unit?.toUpperCase().includes('MMSCFD')){
                            if(data[indexToUpdate].volume){
                                const volume = Number(data[indexToUpdate].volume);
                                if(!Number.isNaN(volume)){
                                    data[indexToUpdate].volume = volume + newMeterValue;
                                }
                            } else {
                                data[indexToUpdate].volume = newMeterValue;
                            }
                        }
                    } else {
                        data[indexToUpdate] = newData;
                    }
                } else {
                    data.push(newData);
                }
                replacedGasPoints.push(...meterPointInNominationPoint);
            }
        }
    }
    // Return unique replaced points
    return Array.from(new Map(replacedGasPoints.map(item => [item.id, item])).values());
}

export function isHasGasData(value: any){
    return (
        value?.registerTimestamp !== null &&
        value?.registerTimestamp !== undefined &&
        value?.registerTimestamp !== '' &&
        value?.volume !== null &&
        value?.volume !== undefined &&
        value?.volume !== '' &&
        value?.heatingValue !== null &&
        value?.heatingValue !== undefined &&
        value?.heatingValue !== '' &&
        value?.wobbeIndex !== null &&
        value?.wobbeIndex !== undefined &&
        value?.wobbeIndex !== '' &&
        value?.energy !== null &&
        value?.energy !== undefined &&
        value?.energy !== ''
    );
}
  
/**
 * Find active metering points that don't have volume, heatingValue, wobbeIndex and energy data for a specific gas day
 */
export function findMissingGasData(activeMeteringPoints: any[], data: any[], gasDay: string): any[] {
    return activeMeteringPoints.filter(activePoint => {
        const pointName = activePoint.metered_point_name;
        
        // Find data entries for this metering point on this gas day
        const pointDataForDay = data.filter(item => 
            item.meterPointId === pointName && item.gasDay === gasDay
        );
        
        // Check if any entry has actual volume, heatingValue, wobbeIndex and energy data (not empty string)
        const hasGasData = pointDataForDay.some(item => {
            if (
            item.value &&
            typeof item.value === 'object'
            ) {
                return isHasGasData(item.value);
            }
            return false;
        });

        return !hasGasData;
    })
}

export function findMissingGasDataFromValueOnly(activeMeteringPoints: any[], data: any[], gasDay: string): any[] {
    return activeMeteringPoints.filter(activePoint => {
        const pointName = activePoint.metered_point_name;
        
        // Find data entries for this metering point on this gas day
        const pointDataForDay = data.filter(item => 
            item.meteringPointId === pointName && item.gasDay === gasDay
        );
        
        // Check if any entry has actual volume, heatingValue, wobbeIndex and energy data (not empty string)
        const hasGasData = pointDataForDay.some(item => {
            if (
            item &&
            typeof item === 'object'
            ) {
                return isHasGasData(item);
            }
            return false;
        });

        return !hasGasData;
    })
}
