export function parseToNumber(value: any) {
    try {
        let valueNumber : number | null = Number(`${value}`?.trim()?.replace(/,/g, ''));
        if (Number.isNaN(valueNumber)) {
            valueNumber = null;
        }
        return valueNumber;
    } catch (error) {
        return null;
    }
}

export function parseToNumber3Decimal(value: any) {
    const valueNumber = parseToNumber(value)
    const value3Decimal = valueNumber == null ? null : parseFloat(valueNumber.toFixed(3))
    return value3Decimal
}