import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class AccountManageRoleMasterService {
  constructor(private prisma: PrismaService) {}

  async roleMaster() {
    const roleMaster = await this.prisma.role.findMany({
      include: {
        user_type: true,
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
        active: true,
        id: { not: 1 },
      },
      orderBy: {
        id: 'desc',
      },
    });
    return roleMaster;
  }

  async roleMasterOnce(id: any) {
    const roleMaster = await this.prisma.role.findFirst({
      include: {
        user_type: true,
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
        id: Number(id),
      },
    });
    return roleMaster;
  }

  async roleMasterDuplicate(ids: any, payload: any) {
    // try {
    const { id, start_date, end_date, ...dataWithout } = payload;

    const ckRole = await this.prisma.role.findFirst({
      where: {
        name: dataWithout?.name,
        user_type_id: Number(dataWithout?.user_type_id),
      },
    });

    if (ckRole) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: 'name',
          error: 'Role name & user type already exists.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const roleMasterCreate = await this.prisma.role.create({
      data: {
        ...dataWithout,
        start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
        end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
        active: true,
        create_date: getTodayNowAdd7().toDate(),
      },
    });

    const menus_config: any = await this.prisma.menus_config.findMany({
      where: {
        role_id: Number(ids),
      },
    });
    for (let i = 0; i < menus_config.length; i++) {
      const { id: sId, role_id, ...dataWithoutId } = menus_config[i];
      await this.prisma.menus_config.create({
        data: {
          ...dataWithoutId,
          role_id: roleMasterCreate?.id,
        },
      });
    }
    return roleMasterCreate;
    // } catch (error) {
    //   if (error.code === 'P2002' && error.meta?.target.includes('name')) {
    //     throw new HttpException(
    //       {
    //         status: HttpStatus.BAD_REQUEST,
    //         key: 'name',
    //         error: 'Role name already exists. Please choose another name.',
    //       },
    //       HttpStatus.BAD_REQUEST,
    //     );
    //   }
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.INTERNAL_SERVER_ERROR,
    //       error: 'Internal server error',
    //     },
    //     HttpStatus.INTERNAL_SERVER_ERROR,
    //   );
    // }
  }

  async roleMasterCreate(payload: any, userId: any) {
    // try {
    const { start_date, end_date, user_type_id, ...dataWithout } = payload;

    // user_type_id
    // name
    const ckRole = await this.prisma.role.findFirst({
      where: {
        name: dataWithout?.name,
        user_type_id: Number(user_type_id),
      },
    });

    if (ckRole) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: 'name',
          error: 'Role name & user type already exists.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const roleMasterCreate = await this.prisma.role.create({
      data: {
        ...dataWithout,
        user_type: {
          connect: {
            id: Number(user_type_id),
          },
        },
        start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
        end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
        active: true,
        create_date: getTodayNowAdd7().toDate(),
        create_by_account: {
          connect: {
            id: Number(userId),
          },
        },
        create_date_num: getTodayNowAdd7().unix(),
      },
    });
    const menus: any = await this.prisma.menus.findMany();

    console.log('Number(user_type_id) : ', Number(user_type_id));
    for (let i = 0; i < menus.length; i++) {
      await this.prisma.menus_config.create({
        data: {
          role_id: roleMasterCreate?.id,
          menus_id: menus[i]?.id,
          parent: menus[i]?.parent,
          seq: menus[i]?.seq,
          // user_type_id new
          f_view:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_view
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_view
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_view
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_view
                    : null,
          f_create:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_create
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_create
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_create
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_create
                    : null,
          f_edit:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_edit
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_edit
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_edit
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_edit
                    : null,
          f_import:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_import
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_import
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_import
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_import
                    : null,
          f_export:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_export
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_export
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_export
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_export
                    : null,
          f_approved:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_approved
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_approved
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_approved
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_approved
                    : null,
          f_noti_inapp:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_noti_email
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_noti_email
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_noti_email
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_noti_inapp
                    : null,
          f_noti_email:
            Number(user_type_id) === 1
              ? menus[i]?.default_f_noti_inapp
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_f_noti_inapp
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_f_noti_inapp
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_f_noti_email
                    : null,
          b_manage:
            Number(user_type_id) === 1
              ? menus[i]?.default_b_manage
              : Number(user_type_id) === 2
                ? menus[i]?.tso_default_b_manage
                : Number(user_type_id) === 3
                  ? menus[i]?.shipper_default_b_manage
                  : Number(user_type_id) === 4
                    ? menus[i]?.other_default_b_manage
                    : false,
        },
      });
    }
    return roleMasterCreate;
    // } catch (error) {
    //   if (error.code === 'P2002' && error.meta?.target.includes('name')) {
    //     throw new HttpException(
    //       {
    //         status: HttpStatus.BAD_REQUEST,
    //         key: 'name',
    //         error: 'Role name already exists. Please choose another name.',
    //       },
    //       HttpStatus.BAD_REQUEST,
    //     );
    //   }
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.INTERNAL_SERVER_ERROR,
    //       error: 'Internal server error',
    //     },
    //     HttpStatus.INTERNAL_SERVER_ERROR,
    //   );
    // }
  }

  async roleMasterEdit(id: any, payload: any, userId: any) {
    // try {
    const { start_date, end_date, ...dataWithout } = payload;

    const ckRole = await this.prisma.role.findFirst({
      where: {
        id: { not: Number(id) },
        name: dataWithout?.name,
        user_type_id: Number(dataWithout?.user_type_id),
      },
    });

    if (ckRole) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: 'name',
          error: 'Role name & user type already exists.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const userTypeIdOld = ckRole?.user_type_id;
    if (userTypeIdOld !== dataWithout?.user_type_id) {
      //

      await this.prisma.menus_config.deleteMany({
        where: {
          role_id: Number(id),
        },
      });
      const menus: any = await this.prisma.menus.findMany();

      for (let i = 0; i < menus.length; i++) {
        await this.prisma.menus_config.create({
          data: {
            role_id: Number(id),
            menus_id: menus[i]?.id,
            parent: menus[i]?.parent,
            seq: menus[i]?.seq,
            // user_type_id new
            f_view:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_view
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_view
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_view
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_view
                      : null,
            f_create:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_create
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_create
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_create
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_create
                      : null,
            f_edit:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_edit
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_edit
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_edit
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_edit
                      : null,
            f_import:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_import
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_import
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_import
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_import
                      : null,
            f_export:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_export
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_export
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_export
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_export
                      : null,
            f_approved:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_approved
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_approved
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_approved
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_approved
                      : null,
            f_noti_inapp:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_noti_email
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_noti_email
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_noti_email
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_noti_inapp
                      : null,
            f_noti_email:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_f_noti_inapp
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_f_noti_inapp
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_f_noti_inapp
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_f_noti_email
                      : null,
            b_manage:
              Number(dataWithout?.user_type_id) === 1
                ? menus[i]?.default_b_manage
                : Number(dataWithout?.user_type_id) === 2
                  ? menus[i]?.tso_default_b_manage
                  : Number(dataWithout?.user_type_id) === 3
                    ? menus[i]?.shipper_default_b_manage
                    : Number(dataWithout?.user_type_id) === 4
                      ? menus[i]?.other_default_b_manage
                      : false,
          },
        });
      }
    }

    const roleMasterEdit = await this.prisma.role.update({
      where: {
        id: Number(id),
      },
      data: {
        ...dataWithout,
        start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
        end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
        active: true,
        update_date: getTodayNowAdd7().toDate(),
        update_by: Number(userId),
        update_date_num: getTodayNowAdd7().unix(),
      },
    });

    // user_type_id

    return roleMasterEdit;
    // } catch (error) {
    //   if (error.code === 'P2002' && error.meta?.target.includes('name')) {
    //     throw new HttpException(
    //       {
    //         status: HttpStatus.BAD_REQUEST,
    //         key: 'name',
    //         error: 'Role name already exists. Please choose another name.',
    //       },
    //       HttpStatus.BAD_REQUEST,
    //     );
    //   }
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.INTERNAL_SERVER_ERROR,
    //       error: 'Internal server error',
    //     },
    //     HttpStatus.INTERNAL_SERVER_ERROR,
    //   );
    // }
  }

  async roleActivePermission(payload: any) {
    const { id, ...dataWithoutId } = payload;
    const roleActivePermission = await this.prisma.menus_config.update({
      where: {
        id: payload?.id,
      },
      data: {
        ...dataWithoutId,
      },
    });
    return roleActivePermission;
  }

  async roleMenuPermission(id: any) {
    const roleActivePermission = await this.prisma.menus_config.findMany({
      where: {
        role_id: Number(id),
      },
      include: {
        menus: true,
      },
      orderBy: [
        {
          menus: {
            seq: 'asc', // จัดเรียงตาม seq ก่อน
          },
        },
        {
          menus: {
            parent: 'asc', // จัดเรียงตาม parent ต่อมา
          },
        },
      ],
    });
    return roleActivePermission;
  }
}
