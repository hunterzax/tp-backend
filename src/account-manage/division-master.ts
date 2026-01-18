import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class AccountManageDivisionMasterService {
  constructor(private prisma: PrismaService) {}

  async divisionMaster() {
    const divisionMaster = await this.prisma.division.findMany({
      include: {
        create_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        update_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });
    return divisionMaster;
  }

  async divisionNotUse() {
    const divisionNotUse = await this.prisma.division.findMany({
      include: {
        create_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        update_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      where: {
        group_id: null,
      },
      orderBy: {
        id: 'asc',
      },
    });
    return divisionNotUse;
  }

  async divisionNotUseWayEdit(id: any) {
    const divisionNotUse = await this.prisma.division.findMany({
      where: {
        OR: [{ group_id: null }, { group_id: Number(id) }],
      },
      orderBy: {
        id: 'asc',
      },
    });
    return divisionNotUse;
  }
}
