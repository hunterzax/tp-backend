import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getTodayStartAdd7, getTodayEndAdd7, getTodayNowAdd7 } from '../../common/utils/date.util';

export interface InitialSetupResult {
  todayStart: Date;
  todayEnd: Date;
  nowAts: any;
  gAuserType: any;
}

@Injectable()
export class InitialSetupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * STEP 1: INITIAL SETUP - ตั้งค่าเริ่มต้นและดึงข้อมูล user group
   * @param userId - ID ของผู้ใช้
   * @returns InitialSetupResult - ข้อมูลที่ตั้งค่าเริ่มต้น
   */
  async executeInitialSetup(userId: number): Promise<InitialSetupResult> {
    try {
      // Get current date ranges for validation (with 7-day offset)
      const todayStart = getTodayStartAdd7().toDate();
      const todayEnd = getTodayEndAdd7().toDate();
      const nowAts = getTodayNowAdd7();

      // Get user group information for permission checking
      const gAuserType = await this.prisma.group.findFirst({
        where: {
          account_manage: {
            some: {
              account_id: Number(userId)
            }
          },
        },
      });

      console.log('STEP 1: INITIAL SETUP completed successfully');
      console.log('todayStart:', todayStart);
      console.log('todayEnd:', todayEnd);
      console.log('nowAts:', nowAts);
      console.log('gAuserType:', gAuserType);

      return {
        todayStart,
        todayEnd,
        nowAts,
        gAuserType
      };
    } catch (error) {
      console.error('Error in STEP 1: INITIAL SETUP:', error);
      throw error;
    }
  }
}
