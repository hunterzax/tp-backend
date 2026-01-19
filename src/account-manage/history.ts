import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class AccountManageHistoryService {
  constructor(private prisma: PrismaService) { }

  private safeParseJSON(data: any, defaultValue: any = null) {
    if (!data) return defaultValue;
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error('JSON parse error:', e);
      return defaultValue;
    }
  }

  async history(payload: any, id: any) {
    console.log('---');
    const newObjs =
      payload?.method === 'all'
        ? { type: payload?.type, id_value: Number(id) }
        : { ...payload, id_value: Number(id) };
    const history = await this.prisma.history.findMany({
      where: { ...newObjs },
      orderBy: {
        id: 'desc',
      },
    });
    console.log('history : ', history);
    const newHistory = await history.map((e: any) => {
      e['reqUser'] = this.safeParseJSON(e['reqUser']);
      e['value'] = this.safeParseJSON(e['value']);
      return e;
    });
    return history;
  }
}
