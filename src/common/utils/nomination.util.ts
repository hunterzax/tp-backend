import { parseToNumber3Decimal } from "./number.util";



export function readNomFromJsonAs3Decimal(nominationRowJsonDataTemp: any, key: string) {
  return parseToNumber3Decimal(nominationRowJsonDataTemp[key])
}