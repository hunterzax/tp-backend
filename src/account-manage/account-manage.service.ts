import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { EmailClientService } from 'src/grpc/email-service.service';
import {
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import { writeReq } from 'src/common/utils/write-req.util';
import { generatePassword, genPass, genTokenReset } from 'src/common/utils/account.util';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class AccountManageService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly emailClientService: EmailClientService,
  ) { }

  private safeParseJSON(data: any, defaultValue: any = null) {
    if (!data) return defaultValue;
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error('JSON parse error:', e);
      return defaultValue;
    }
  }

  async loginLogs(id: any, event: any, temps: any) {
    const loginLogs = await this.prisma.login_logs.create({
      data: {
        event: event,
        account_id: Number(id || 0),
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
        temps: temps,
      },
    });
    return loginLogs;
  }

  async loginCheckCount(email: any, count: any) {
    const acc = await this.prisma.account.findFirst({
      where: {
        email: email,
      },
    });

    if (!!acc && count === 3) {
      // เพิ่ม 15 นาทีจากเวลาปัจจุบัน
      const nowPlus15Minutes = getTodayNowAdd7().add(15, 'minute').toDate();

      console.log('Time + 15 minutes:', nowPlus15Minutes);

      const updateLogDate = await this.prisma.account.updateMany({
        where: {
          email: email,
        },
        data: {
          log_date: nowPlus15Minutes,
        },
      });
    }

    return {
      data: {
        email: email,
        check: !!acc,
        message:
          'check = true (มีจริง), false (ไม่มี) | count = 3 จะโดน log 15 นาที',
        count: count,
      },
    };
  }

  async checkLogDate(email: any) {
    // log_date
    const nowDates = getTodayNowAdd7().toDate();

    const acc = await this.prisma.account.findFirst({
      where: {
        email: email,
      },
    });
    // เช็คเวลาปุ่จจับนว่าเกิน log_date ยัง
    if (acc) {
      // logDate: 2024-12-24T15:13:02.509Z
      const logDate = acc?.log_date;
      // ตรวจสอบว่า logDate เกินเวลาปัจจุบันหรือยัง
      if (logDate === null || (logDate && dayjs(nowDates).isAfter(logDate))) {
        console.log('logDate เกินเวลาปัจจุบัน');
        return true; // logDate เกินเวลาปัจจุบัน
      } else {
        console.log('logDate ไม่เกินเวลาปัจจุบัน');
        throw new HttpException(
          {
            status: HttpStatus.SERVICE_UNAVAILABLE,
            error: `login ไม่ได้จนถึงเวลา ${dayjs(logDate).format('YYYY-MM-DD HH:mm:ss')}`,
            data: {
              logDate: dayjs(logDate).format('HH:mm:ss'),
            },
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    } else {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'Invalid username or password.',
          data: false,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // return;
  }

  async accountLocal(id: any) {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    try {
      const roleExp = await this.prisma.role.findFirst({
        where: {
          account_role: {
            some: {
              account_manage: {
                account_id: Number(id || 0),
              },
            },
          },
        },
      });
      const isInRangeRole = (!!roleExp?.start_date && !!roleExp?.end_date) ? dayjs(todayStart).isBetween(
        dayjs(roleExp?.start_date),
        dayjs(roleExp?.end_date),
        null,
        '[]',
      ) : false;
      if (!isInRangeRole) {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            key: null,
            error: 2,
          },
          HttpStatus.FORBIDDEN,
        );
      }

      const groupExp = await this.prisma.group.findFirst({
        where: {
          account_manage: {
            some: {
              account_id: Number(id || 0),
            },
          },
        },
      });
      const isInRangeGroup = (!!groupExp?.start_date && !!groupExp?.end_date) ? dayjs(todayStart).isBetween(
        dayjs(groupExp?.start_date),
        dayjs(groupExp?.end_date),
        null,
        '[]',
      ) : false;
      if (!isInRangeGroup) {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            key: null,
            error: 3,
          },
          HttpStatus.FORBIDDEN,
        );
      }

      const account = await this.prisma.account.findUnique({
        where: {
          id: Number(id || 0),
          account_manage: {
            some: {
              account_role: {
                some: {
                  role: {
                    AND: [
                      {
                        start_date: {
                          lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                        },
                      },
                      {
                        OR: [
                          { end_date: null }, // ถ้า end_date เป็น null
                          { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                        ],
                      },
                    ],
                  },
                },
              },
              mode_account_id: 2,
              group: {
                AND: [
                  {
                    start_date: {
                      lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                    },
                  },
                  {
                    OR: [
                      { end_date: null }, // ถ้า end_date เป็น null
                      { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                    ],
                  },
                ],
              },
            },
          },
          AND: [
            {
              start_date: {
                lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
              },
            },
            {
              OR: [
                { end_date: null }, // ถ้า end_date เป็น null
                { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
              ],
            },
          ],
        },

        include: {
          account_manage: {
            include: {
              user_type: {
                // include: {
                //   column_table_config: {
                //     include: {
                //       column_table: true,
                //       column_field: true,
                //     },
                //   },
                // },
              },
              mode_account: true,
              division: true,
              group: {
                include: {
                  division: true,
                },
              },
              account_role: {
                include: {
                  role: {
                    where: {
                      active: true,
                    },
                    include: {
                      menus_config: {
                        include: {
                          menus: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          account_password_check: {
            orderBy: {
              create_date: "asc"
            }
          },
        },
      });

      if (account?.account_password_check?.length > 0) {
        const dateCk =
          account?.account_password_check[
            account?.account_password_check?.length - 1
          ]?.create_date;
        // console.log('account : ', account);
        // console.log('dateCk : ', dateCk);
        // console.log(getTodayNowAdd7().toDate());
        // console.log(dayjs(getTodayNowAdd7().toDate()).diff(dayjs(dateCk), 'day'));
        const isMoreThan90Days = dateCk ?
          dayjs(getTodayNowAdd7().toDate()).diff(dayjs(dateCk), 'day') > 90 : false;
        if (isMoreThan90Days) {
          throw new HttpException(
            {
              status: HttpStatus.FORBIDDEN,
              key: null,
              error: 1,
            },
            HttpStatus.FORBIDDEN,
          );
        }
      }

      const { password, ...newAccount } = account;
      return newAccount;
    } catch (error) {
      if (error?.response?.error === 1) {
        const account = await this.prisma.account.findUnique({
          where: {
            id: Number(id || 0),
          },
        });
        throw new HttpException(
          {
            status: HttpStatus.PRECONDITION_FAILED,
            key: null,
            // error: `Password was expired`,
            error: `Your password has expired. Please update it, as passwords must be changed every 90 days for security purposes.`,
            token: await this.genToken({
              sub: account?.id,
              first_name: account?.first_name,
              last_name: account?.last_name,
              username: account?.email,
              type: 'access',
            }),
            // error: `account more 90 day`,
          },
          HttpStatus.PRECONDITION_FAILED,
        );
      } else if (error?.response?.error === 2) {
        throw new HttpException(
          {
            status: HttpStatus.PRECONDITION_FAILED,
            key: null,
            error: `account role expired`,
          },
          HttpStatus.PRECONDITION_FAILED,
        );
      } else if (error?.response?.error === 3) {
        throw new HttpException(
          {
            status: HttpStatus.PRECONDITION_FAILED,
            key: null,
            error: `account group expired`,
          },
          HttpStatus.PRECONDITION_FAILED,
        );
      } else {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            key: null,
            error: `Can not log in, please contact Admin`,
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }

  async accountLocalOnce(id: any) {
    const account = await this.prisma.account.findUnique({
      where: {
        id: Number(id || 0),
      },
      include: {
        account_manage: {
          include: {
            user_type: {
              // include: {
              //   column_table_config: {
              //     include: {
              //       column_table: true,
              //       column_field: true,
              //     },
              //   },
              // },
            },
            mode_account: true,
            division: true,
            group: {
              include: {
                division: true,
              },
            },
            account_role: {
              include: {
                role: {
                  where: {
                    active: true,
                  },
                  include: {
                    menus_config: {
                      include: {
                        menus: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // account_password_check: true,
      },
    });

    const { password, password_gen_origin, password_gen_flag, ...newAccount } =
      account;
    return newAccount;
  }

  async accountLocalGetSure(id: any) {
    try {
      const account = await this.prisma.account.findUnique({
        where: {
          id: Number(id || 0),
        },
        include: {
          account_manage: {
            include: {
              user_type: {
                include: {
                  column_table_config: {
                    include: {
                      column_table: true,
                      column_field: true,
                    },
                  },
                },
              },
              mode_account: true,
              division: true,
              group: {
                include: {
                  division: true,
                },
              },
              account_role: {
                include: {
                  role: {
                    where: {
                      active: true,
                    },
                    include: {
                      menus_config: {
                        include: {
                          menus: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          account_reason: {
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
          },
          type_account: true,
          created_by_account: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
          updated_by_account: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
          login_logs: {
            select: {
              id: true,
              create_date: true,
            },
            orderBy: {
              id: 'desc', // เรียง login_logs ตาม id ในลำดับที่ลดลง
            },
            take: 1,
          },
        },
        // include: {
        //   account_manage: {
        //     include: {
        //       user_type: {
        //         // include: {
        //         //   column_table_config: {
        //         //     include: {
        //         //       column_table: true,
        //         //       column_field: true,
        //         //     },
        //         //   },
        //         // },
        //       },
        //       mode_account: true,
        //       division: true,
        //       group: {
        //         include: {
        //           division: true,
        //         },
        //       },
        //       account_role: {
        //         include: {
        //           role: {
        //             where: {
        //               active: true,
        //             },
        //             include: {
        //               menus_config: {
        //                 include: {
        //                   menus: true,
        //                 },
        //               },
        //             },
        //           },
        //         },
        //       },
        //     },
        //   },
        //   account_password_check: true,
        //   account_reason: {
        //     include: {
        //       create_by_account: {
        //         select: {
        //           id: true,
        //           email: true,
        //           first_name: true,
        //           last_name: true,
        //         },
        //       },
        //       update_by_account: {
        //         select: {
        //           id: true,
        //           email: true,
        //           first_name: true,
        //           last_name: true,
        //         },
        //       },
        //     },
        //   },
        //   type_account: true,
        //   created_by_account: {
        //     select: {
        //       id: true,
        //       email: true,
        //       first_name: true,
        //       last_name: true,
        //     },
        //   },
        //   updated_by_account: {
        //     select: {
        //       id: true,
        //       email: true,
        //       first_name: true,
        //       last_name: true,
        //     },
        //   },
        // },
      });

      const { password, ...newAccount } = account;
      return newAccount;
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          key: null,
          error: `account not match`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async clearLoginSession(email: string[]) {
    return await this.prisma.account.updateMany({
      where: {
        email: {
          in: email,
        },
      },
      data: {
        log_date: null,
        login_flag: null,
        listen_login_date: null,
      },
    });
  }

  async columnConfigAccount(id: any) {
    try {
      const account = await this.prisma.account_manage.findFirst({
        where: {
          account_id: Number(id || 0),
          // account_manage: {
          //   some: {
          //     mode_account_id: 2,
          //   },
          // },
        },
        include: {
          user_type: {
            include: {
              column_table_config: {
                include: {
                  column_table: true,
                  column_field: true,
                },
              },
            },
          },
          mode_account: true,
          division: true,
          group: {
            include: {
              division: true,
            },
          },
          account_role: {
            include: {
              role: {
                where: {
                  active: true,
                },
                include: {
                  menus_config: {
                    include: {
                      menus: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      return account;
    } catch (error) {
      if (error?.response?.error === 1) {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            key: null,
            // error: `Password was expired`,
            error: `Your password has expired. Please update it, as passwords must be changed every 90 days for security purposes.`,
            // error: `account more 90 day`,
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            key: null,
            error: `Can not log in, please contact Admin`,
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }

  async addPass(account_id: any, password: any, passwordHash: any) {
    const check = await this.prisma.account_password_check.findMany({
      where: {
        account_id: Number(account_id || 0),
      },
      orderBy: {
        create_date: 'asc',
      },
    });
    let flagCheck = false;
    await Promise.all(
      check.map(async (item) => {
        const isMatch = await bcrypt.compare(password, item?.password);
        if (isMatch) {
          flagCheck = true;
        }
        return item;
      }),
    );

    if (flagCheck) {
      return true;
    } else {
      if (check.length >= 30) {
        await this.prisma.account_password_check.delete({
          where: {
            id: check[0]?.id,
          },
        });
      }

      await this.prisma.account_password_check.create({
        data: {
          account_id: Number(account_id || 0),
          password: passwordHash,
          create_date: getTodayNowAdd7().toDate(),
        },
      });
      return false;
    }
  }

  async accountReasonCreate(payload: any, userId: any) {
    const { account_id, ...withPayload } = payload || {};
    const reasonCreate = await this.prisma.account_reason.create({
      data: {
        ...withPayload,
        ...(account_id !== null && {
          account: {
            connect: {
              id: account_id,
            },
          },
        }),
        active: true,
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
        create_by_account: {
          connect: {
            id: Number(userId || 0), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
          },
        },
      },
    });
    await this.prisma.account.update({
      where: {
        id: Number(payload?.account_id || 0),
      },
      data: {
        status: payload?.status,
        update_date: getTodayNowAdd7().toDate(),
        update_by: Number(userId || 0),
        update_date_num: getTodayNowAdd7().unix(),
      },
    });

    return reasonCreate;
  }

  async accountLocalGenPassword(id: any, userId: any) {
    const nowAt30 = getTodayNowAdd7().add(30, 'minute').toDate();

    const pass = generatePassword(10);
    const hashPassword = await genPass(pass);
    const passwords = {
      password: hashPassword?.hash,
    };

    const account = await this.prisma.account.update({
      where: {
        id: Number(id || 0),
      },
      data: {
        ...passwords,
        password_gen_origin: pass,
        password_gen_flag: true,
        update_date: getTodayNowAdd7().toDate(),
        update_by: Number(userId || 0),
        update_date_num: getTodayNowAdd7().unix(),
        pass_gen_date: nowAt30,
        login_flag: null, //new https://app.clickup.com/t/86ernzz09
        listen_login_date: null, //new https://app.clickup.com/t/86ernzz09
      },
    });
    return account;
  }

  async account() {
    const account = await this.prisma.account.findMany({
      where: {
        id: { not: 1 },
        account_manage: {
          some: {
            account_role: {
              some: {
                role: {
                  id: { not: 1 },
                },
              },
            },
          },
        },
      },
      include: {
        account_manage: {
          include: {
            user_type: {
              include: {
                column_table_config: {
                  include: {
                    column_table: true,
                    column_field: true,
                  },
                },
              },
            },
            mode_account: true,
            division: true,
            group: {
              include: {
                division: true,
              },
            },
            account_role: {
              include: {
                role: {
                  where: {
                    active: true,
                  },
                  include: {
                    menus_config: {
                      include: {
                        menus: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        account_reason: {
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
        },
        type_account: true,
        created_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        updated_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        login_logs: {
          select: {
            id: true,
            create_date: true,
          },
          orderBy: {
            id: 'desc', // เรียง login_logs ตาม id ในลำดับที่ลดลง
          },
          take: 1,
        },
      },
      orderBy: {
        id: 'asc',
      },
    });
    return account;
  }

  async checkUserId(user_id: any) {
    const account = await this.prisma.account.findFirst({
      where: { user_id: user_id },
    });
    return !!account;
  }

  async checkUserIdUse(user_id: any, id: any) {
    const account = await this.prisma.account.findFirst({
      where: {
        user_id: user_id,
        id: {
          not: Number(id || 0),
        },
      },
    });
    return !!account;
  }

  async registerAaccount(payload: any, userId: any) {
    try {
      const {
        account_manage,
        role_manage,
        start_date,
        end_date,
        ...dataWithout
      } = payload;
      const pass = generatePassword(10);
      const hashPassword = await genPass(pass);
      const nowAt30 = getTodayNowAdd7().add(30, 'minute').toDate();

      const account = await this.prisma.account.create({
        data: {
          ...dataWithout,
          password:
            account_manage?.mode_account_id === 2 ? hashPassword?.hash : null,
          active: true,
          password_gen_origin:
            account_manage?.mode_account_id === 2 ? pass : null,
          password_gen_flag:
            account_manage?.mode_account_id === 2 ? true : null,
          pass_gen_date: nowAt30,
          type_account_id: 1,
          start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
          end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
          create_date: getTodayNowAdd7().toDate(),
          create_by: Number(userId || 0),
          // create_by_account: {
          //   connect: {
          //     id: Number(userId),
          //   },
          // },
          create_date_num: getTodayNowAdd7().unix(),
        },
      });
      const accountManage = await this.prisma.account_manage.create({
        data: {
          account_id: account?.id,
          ...account_manage,
        },
      });
      if (role_manage.length > 0) {
        for (let i = 0; i < role_manage.length; i++) {
          await this.prisma.account_role.create({
            data: {
              account_manage_id: accountManage?.id,
              role_id: role_manage[i]?.id,
            },
          });
        }
      }

      return {
        data: account,
        passwordGen: pass,
      };
    } catch (error) {
      if (
        (error.code === 'P2002' && error.meta?.target.includes('email')) ||
        error.meta?.target.includes('user_id')
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: error.meta?.target.includes('id_name') ? 'id_name' : 'email',
            error: `account ${error.meta?.target.includes('id_name') ? 'id_name' : 'email'} already exists. Please choose another ${error.meta?.target.includes('id_name') ? 'id_name' : 'email'}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal server error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async editAccount(id: any, payload: any, userId: any, req: any) {
    try {
      const {
        account_manage,
        role_manage,
        start_date,
        end_date,
        status,
        ...dataWithout
      } = payload;

      const findAcc = await this.prisma.account.findUnique({
        include: {
          account_manage: {
            include: {
              account_role: true,
            },
          },
        },
        where: {
          id: Number(id || 0),
        },
      });
      let pass = null;
      let account = null;
      if (
        account_manage?.mode_account_id === 1 ||
        (findAcc?.account_manage?.[0]?.mode_account_id ===
          account_manage?.mode_account_id)
      ) {
        const password_gen_flag =
          account_manage?.mode_account_id === 1
            ? {}
            : { password_gen_flag: null };

        // Natchanon@prompt.co.th
        // komphakawat@gmail.com
        // chuleeporn@nueamek.com
        console.log('id : ', id);
        console.log('payload : ', payload);

        account = await this.prisma.account.update({
          where: {
            id: Number(id || 0),
          },
          data: {
            ...dataWithout,
            status: status,
            ...password_gen_flag,
            start_date: start_date
              ? getTodayNowAdd7(start_date).toDate()
              : null,
            end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
            update_date: getTodayNowAdd7().toDate(),
            update_by: Number(userId || 0),
            update_date_num: getTodayNowAdd7().unix(),
          },
        });
        await this.prisma.account_manage.deleteMany({
          where: { account_id: account?.id },
        });
        await this.prisma.account_role.deleteMany({
          where: { account_manage_id: null },
        });
        console.log('---1');
        const accountManage = await this.prisma.account_manage.create({
          data: {
            account_id: account?.id,
            ...account_manage,
          },
        });
        console.log('---2');
        // return null
        if (role_manage.length > 0) {
          for (let i = 0; i < role_manage.length; i++) {
            await this.prisma.account_role.create({
              data: {
                account_manage_id: accountManage?.id,
                role_id: role_manage[i]?.id,
              },
            });
          }
        }
      } else {
        pass = generatePassword(10);
        const hashPassword = await genPass(pass);
        const passwords = {
          password: hashPassword?.hash,
        };
        const nowAt30 = getTodayNowAdd7().add(30, 'minute').toDate();

        account = await this.prisma.account.update({
          where: {
            id: Number(id || 0),
          },
          data: {
            ...dataWithout,
            ...passwords,
            password_gen_origin: pass,
            password_gen_flag: true,
            pass_gen_date: nowAt30,
            start_date: start_date
              ? getTodayNowAdd7(start_date).toDate()
              : null,
            end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
            update_date: getTodayNowAdd7().toDate(),
            update_by: Number(userId || 0),
            update_date_num: getTodayNowAdd7().unix(),
          },
        });
        await this.prisma.account_manage.deleteMany({
          where: { account_id: account?.id },
        });
        await this.prisma.account_role.deleteMany({
          where: { account_manage_id: null },
        });
        const accountManage = await this.prisma.account_manage.create({
          data: {
            account_id: account?.id,
            ...account_manage,
          },
        });
        if (role_manage.length > 0) {
          for (let i = 0; i < role_manage.length; i++) {
            await this.prisma.account_role.create({
              data: {
                account_manage_id: accountManage?.id,
                role_id: role_manage[i]?.id,
              },
            });
          }
        }
      }
      const roleOld = (findAcc?.account_manage[0]?.account_role || []).map(
        (e: any) => e?.role_id,
      );
      const roleNew = (payload?.role_manage || []).map((e: any) => e?.id);

      // (หายไป)
      const removedItems = roleOld.filter((item: any) => {
        return !roleNew.includes(item);
      });
      const unchangedItems = roleOld.filter((item: any) => {
        return roleNew.includes(item);
      });
      // (มาใหม่)
      // const addedItems = roleNew.filter((item:any) => { return !roleOld.includes(item) });

      // console.log('Removed Items:', removedItems); // ผลลัพธ์จะเป็น [1]

      if (
        findAcc?.account_manage?.[0]?.mode_account_id !==
        account_manage?.mode_account_id ||
        removedItems?.length > 0
      ) {
        for (let i = 0; i < removedItems.length; i++) {
          await this.prisma.system_login_account.deleteMany({
            where: {
              account_id: Number(id || 0),
              system_login: {
                role_id: removedItems[i],
              },
            },
          });
        }
        for (let i = 0; i < removedItems.length; i++) {
          const systemLoginOneRole = await this.systemLoginOneRole(
            removedItems[i],
          );
          await writeReq(
            this.prisma,
            'DAM',
            req,
            'systemLogin',
            'changeFromAccount',
            systemLoginOneRole,
          );
        }

        for (let i = 0; i < unchangedItems.length; i++) {
          if (
            findAcc?.account_manage[0]?.mode_account_id !==
            account_manage?.mode_account_id
          ) {
            const systemLoginOneRole = await this.systemLoginOneRole(
              unchangedItems[i],
            );
            await writeReq(
              this.prisma,
              'DAM',
              req,
              'systemLogin',
              'changeFromAccount',
              systemLoginOneRole,
            );
          }
        }
      }
      return {
        data: { id: account?.id },
        passwordGen: pass,
      };
    } catch (error) {
      if (
        (error.code === 'P2002' && error.meta?.target.includes('email')) ||
        error.meta?.target.includes('user_id')
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: error.meta?.target.includes('id_name') ? 'id_name' : 'email',
            error: `account ${error.meta?.target.includes('id_name') ? 'id_name' : 'email'} already exists. Please choose another ${error.meta?.target.includes('id_name') ? 'id_name' : 'email'}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal server error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async convertUrlToBase64(url: any, type: any) {
    const axios = require('axios');
    const { assertSafeExternalUrl } = await import('src/common/utils/url.util');
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new HttpException({ status: HttpStatus.BAD_REQUEST, error: 'Empty URL' }, HttpStatus.BAD_REQUEST);
    }
    try {
      assertSafeExternalUrl(url);
    } catch (e) {
      throw new HttpException({ status: HttpStatus.BAD_REQUEST, error: `Invalid or unsafe URL: ${e?.message || 'unknown'}` }, HttpStatus.BAD_REQUEST);
    }

    const data = JSON.stringify({
      url: url,
      format: type?.toUpperCase() || '',
    });

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${process.env.GATEWAY_BASE_URL || `https://${process.env.IP_URL}:${process.env.KONG_PORT}`}/files/convert-to-base64/`,
      headers: {
        'Content-Type': 'application/json',
      },
      data: data,
    };

    const response = await axios.request(config);
    return response?.data?.base64;
  }

  async signature(id: any, payload: any, userId: any, req: any) {
    try {
      const { signature, mimetype } = payload || {};

      const base64s = await this.convertUrlToBase64(signature, mimetype);

      const signatures = await this.prisma.account.update({
        where: {
          id: Number(id || 0),
        },
        data: {
          signature: signature,
          signature_base_64: base64s,
          update_date: getTodayNowAdd7().toDate(),
          update_by: Number(userId || 0),
          update_date_num: getTodayNowAdd7().unix(),
        },
      });
      return signatures;
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal server error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async systemLoginOneRole(id: any) {
    const systemLogin = await this.prisma.system_login.findFirst({
      include: {
        role: true,
        mode_account: true,
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
        system_login_account: {
          include: {
            account: {
              select: {
                id: true,
                email: true,
                status: true,
                password_gen_flag: true,
                password_gen_origin: true,
              },
            },
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
        },
      },
      where: {
        role_id: Number(id || 0),
      },
    });
    return systemLogin;
  }

  async forgotPassword(email: any) {
    const account = await this.prisma.account.findUnique({
      where: {
        email: email.toLowerCase(),
      },
    });
    const token = await genTokenReset(this.jwtService, account?.id, account?.email);

    if (!account?.email) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: null,
          error: `error`,
          message: 'error',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {
      const resMail = await this.emailClientService.sendEmail(
        account?.email,
        'forgot-password',
        `${process.env.WEBS}/en/reset-password?ref=${token}`,
      );
      return resMail;
    }
  }

  async getLink(email: any) {
    const account = await this.prisma.account.findUnique({
      where: {
        email: email,
      },
    });
    const token = await genTokenReset(this.jwtService, account?.id, account?.email);

    if (!account?.email) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: null,
          error: `error`,
          message: 'error',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {
      return {
        link: `${process.env.WEBS}/en/reset-password?ref=${token}`,
      };
    }
  }

  async resetPassword(ref: any, passwords: any) {
    const decoded = this.jwtService.decode(ref);
    if (decoded?.sub) {
      const password = await genPass(passwords);
      const addPass = await this.addPass(
        decoded?.sub,
        passwords,
        password?.hash,
      );

      if (addPass) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: `Cannot reuse a previous password. Please choose a new password that has not been used in the last 30 times`,
            error: `error`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const account = await this.prisma.account.update({
        where: {
          id: Number(decoded?.sub || 0),
        },
        data: {
          password: password?.hash,
          password_gen_flag: false,
          login_flag: null,
          listen_login_date: null,
        },
      });
      return {
        id: Number(decoded?.sub || 0),
        account: account,
      };
    } else {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: null,
          error: `error`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async checkPassword(ref: any, passwords: any) {
    const decoded = this.jwtService.decode(ref);
    if (decoded?.sub) {
      console.log(decoded?.sub);
      const password = await genPass(passwords);
      const addPass = await this.addPass(
        decoded?.sub,
        passwords,
        password?.hash,
      );

      if (addPass) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: `password ซ้ำ`,
            error: `error`,
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        return true;
      }
    } else {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: null,
          error: `error`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async genToken(payload: any) {
    return await this.jwtService.signAsync(payload);
  }

  async findAccountDate({ username, pass }) {
    const user: any = await this.prisma.account.findUnique({
      where: {
        email: username,
      },
    });
    const isMatch = await bcrypt.compare(pass, user?.password);
    if (!isMatch) {
      throw new UnauthorizedException();
    } else {
      const nowAt = getTodayNowAdd7();

      const startDate = getTodayStartAdd7(user?.start_date).toDate();
      const endDate = user?.end_date
        ? getTodayEndAdd7(user?.end_date).toDate()
        : null;

      // ตรวจสอบเงื่อนไข
      const isInRange =
        nowAt.isAfter(startDate) &&
        (endDate === null || nowAt.isBefore(dayjs(endDate)));

      if (!isInRange) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: `your user is inactivated, please contact administrator`,
            error: `your user is inactivated, please contact administrator`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      return true;
    }
  }

  async findAccountLoginFlag({ username, pass }) {
    const user: any = await this.prisma.account.findUnique({
      where: {
        email: username,
      },
      include: {
        account_manage: {
          include: {
            account_role: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });
    if (user?.login_flag) {
      // Only allow super admin bypass in non-production environments
      if (process.env.NODE_ENV !== 'production') {
        const isSuperAdmin = user?.account_manage?.some((item: any) =>
          item?.account_role?.some(
            (account_role: any) =>
              account_role?.role?.name == 'Super Admin Default' ||
              account_role?.role?.id == 1,
          ),
        );

        if (isSuperAdmin) {
          return true;
        }
      }

      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: `Your account already logged-in in another device.`,
          error: `Your account already logged-in in another device.`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    return true;
  }

  async findAccountLoginFlagUpdateActive({ username }) {
    const nowAt = getTodayNowAdd7().toDate();

    await this.prisma.account.update({
      where: {
        email: username,
      },
      data: {
        login_flag: true,
        listen_login_date: nowAt,
      },
    });
    return true;
  }

  async updateLogoutFlag(userId: any) {
    console.log('userId : ', userId);
    await this.prisma.account.update({
      where: {
        id: Number(userId || 0),
      },
      data: {
        login_flag: null,
        listen_login_date: null,
      },
    });
    return true;
  }

  async updateLogoutFlagEmail(email: any) {
    console.log('email : ', email);
    await this.prisma.account.updateMany({
      where: {
        email: email,
      },
      data: {
        login_flag: null,
        listen_login_date: null,
      },
    });
    return true;
  }

  async updateFlagTaC(userId: any) {
    const nowAt = getTodayNowAdd7().toDate();

    await this.prisma.account.update({
      where: {
        id: Number(userId || 0),
      },
      data: {
        login_flag: true,
        listen_login_date: nowAt,
      },
    });
    return true;
  }

  async updateLoginListen(userId: any) {
    console.log('userId : ', userId);
    const ck = await this.prisma.account.findFirst({
      where: {
        id: Number(userId || 0),
      },
    });
    if (ck.listen_login_date === null) {
      return false;
    } else {
      const nowAt = getTodayNowAdd7().toDate();

      await this.prisma.account.update({
        where: {
          id: Number(userId || 0),
        },
        data: {
          login_flag: true,
          listen_login_date: nowAt,
        },
      });
      return true;
    }
  }

  async findAccount({ username, pass }) {
    const user: any = await this.prisma.account.findUnique({
      where: {
        email: username,
      },
    });
    const isMatch = await bcrypt.compare(pass, user?.password);
    if (!isMatch) {
      throw new UnauthorizedException();
    }
    return user;
  }

  async ckGen30Pass(user: any) {
    if (user?.password_gen_flag) {
      const nowAt = getTodayNowAdd7();
      const passGenDate = getTodayNowAdd7(user?.pass_gen_date);
      const isPassGenDateBeforeNow = passGenDate.isBefore(nowAt);

      return isPassGenDateBeforeNow;
    } else {
      return false;
    }
  }
}
