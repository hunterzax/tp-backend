import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export interface FileTypeValidationResult {
  findData: any[];
  checkType: string | null;
  nomination_type_id: number | null;
}

@Injectable()
export class FileTypeValidationService {

  private safeParseJSON(jsonString: string): any {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.error('Error parsing JSON:', error);
      return []; // Return empty array as fallback for findData
    }
  }

  /**

   * STEP 2: FILE TYPE VALIDATION - ตรวจสอบประเภทไฟล์ (Daily/Weekly)
   * @param file - ไฟล์ที่ส่งมาจาก gRPC
   * @param tabType - ประเภทที่คาดหวัง (1 = Daily, 2 = Weekly)
   * @returns FileTypeValidationResult - ผลลัพธ์การตรวจสอบ
   */
  async executeFileTypeValidation(file: any, tabType: number): Promise<FileTypeValidationResult> {
    try {
      // Parse the multi-sheet JSON data from gRPC
      const findData = this.safeParseJSON(file?.jsonDataMultiSheet);

      // Determine nomination type from sheet names
      const checkType = findData.reduce((acc: string | null, f: any) => {
        if (f?.sheet === 'Daily Nomination') return 'Daily Nomination';
        if (f?.sheet === 'Weekly Nomination') return 'Weekly Nomination';
        return acc;
      }, null);

      // Map sheet type to nomination type ID
      const nomination_type_id =
        checkType === 'Daily Nomination'
          ? 1
          : checkType === 'Weekly Nomination'
            ? 2
            : null;

      // Validate that file type matches the expected tabType
      console.log("nomination_type_id : ", nomination_type_id);
      console.log("tabType : ", tabType);

      if (nomination_type_id != tabType) {
        console.log('File type validation failed');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'File template does not match the required format.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      console.log('STEP 2: FILE TYPE VALIDATION completed successfully');
      console.log('checkType:', checkType);
      console.log('nomination_type_id:', nomination_type_id);

      return {
        findData,
        checkType,
        nomination_type_id
      };
    } catch (error) {
      console.error('Error in STEP 2: FILE TYPE VALIDATION:', error);
      throw error;
    }
  }
}
