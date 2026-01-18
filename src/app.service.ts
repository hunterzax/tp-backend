import { Cache } from 'cache-manager';
// import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { Response } from 'express';
import axios from 'axios';
import { tryParseUrl } from 'src/common/utils/url.util';

@Injectable()
export class AppService {
  constructor(
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) {}

  // async getHello() {
  //   await this.cacheService.set('cach-tpa-service-master', {
  //     name: 'test cache.',
  //   });
  //   let testCache: any = await this.cacheService.get('cach-tpa-service-master');
  //   return {
  //     messageCache: testCache,
  //     apiSQLTest: await this.prisma.account.findMany({}),
  //   };
  // }
  // https://10.100.94.170:4001/demoHtml
  async demoHtml(response: Response, payload: any) {
    try {
      // เรียก API ที่ส่งไฟล์ Excel
      // start_date=2025-01-01&end_date=2025-02-28&skip=100&limit=100&tab=1
      // https://10.100.91.151:4001/demoHtml
      // https://localhost:4001/demoHtml
      // https://10.100.101.15:8010/master/demoHtml
    if (process.env.NODE_ENV !== 'production') console.log('---1');

      const axiosResponse = await axios({
        // url: 'https://tpa-gateway.nueamek.app/master/export-files/tariff/imbalance-capacity-report',
        // url: 'https://localhost:4001/export-files/tariff/imbalance-capacity-report',
        url: (() => {
          const base = process.env.GATEWAY_BASE_URL || `https://${process.env.IP_URL}:${process.env.KONG_PORT}`;
          const u = tryParseUrl(base);
          if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
            throw new Error('Invalid GATEWAY_BASE_URL: must be http/https URL');
          }
          return `${base}/export-files/tariff/imbalance-capacity-report`;
        })(),
        method: 'POST',
        responseType: 'stream',
        data: {
          id: '370',
          companyName: 'PTT Public Company Limited',
          shipperName: 'EGAT Shipper',
          month: 'Apr',
          year: '2024',
          reportedBy: {
            name: 'Ms.Wipada Yenyin',
            position: 'Senior Engineer',
            division: 'Transmission Contracts & Regulatory Management Division',
          },
          manager: {
            name: 'Ms. Tanatchaporn',
            position: 'Manager of',
            division: 'Transmission Contracts & Regulatory Management Division',
          },
        },
      });
    if (process.env.NODE_ENV !== 'production') console.log('--2-');

      // ตั้งค่า Header สำหรับดาวน์โหลดไฟล์
      response.set({
        'Content-Type': axiosResponse.headers['content-type'],
        'Content-Disposition':
          axiosResponse.headers['content-disposition'] ||
          'attachment; filename="exported_file.xlsx"',
      });

      // ส่ง stream ของไฟล์ไปยัง client
      axiosResponse.data.pipe(response);
    } catch (error) {
      console.error('Error fetching file');
      response.status(500).send({
        message: 'Failed to fetch the file.',
        error: error.message,
      });
    }
  }
}
