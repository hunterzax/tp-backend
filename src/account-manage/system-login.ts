import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
import { writeReq } from 'src/common/utils/write-req.util';
import { AccountManageService } from './account-manage.service';
import { generatePassword, genPass } from 'src/common/utils/account.util';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class AccountManageSystemLoginService {
  constructor(
    private readonly accountManageService: AccountManageService,
    private prisma: PrismaService,
  ) { }

  async systemLogin() {
    const systemLogin = await this.prisma.system_login.findMany({
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
                first_name: true,
                last_name: true,
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
    });
    return systemLogin;
  }

  async systemLoginRole() {
    const systemLoginRole = await this.prisma.role.findMany({
      include: {
        account_role: {
          include: {
            account_manage: {
              include: {
                account: {
                  select: {
                    id: true,
                    email: true,
                    first_name: true,
                    last_name: true,
                    status: true,
                    password_gen_flag: true,
                    password_gen_origin: true,
                  },
                },
              },
            },
          },
        },
      },
      where: {
        system_login: {
          none: {},
        },
      },
      orderBy: {
        id: 'asc',
      },
    });
    return systemLoginRole;
  }

  async systemLoginRoleUse(id: any) {
    const systemLoginRole = await this.prisma.role.findMany({
      include: {
        account_role: {
          include: {
            account_manage: {
              include: {
                account: {
                  select: {
                    id: true,
                    email: true,
                    first_name: true,
                    last_name: true,
                    status: true,
                    password_gen_flag: true,
                    password_gen_origin: true,
                  },
                },
              },
            },
          },
        },
        system_login: {
          include: {
            system_login_account: {
              include: {
                account: {
                  select: {
                    id: true,
                    email: true,
                    first_name: true,
                    last_name: true,
                    status: true,
                    password_gen_flag: true,
                    password_gen_origin: true,
                  },
                },
              },
            },
          },
        },
      },
      where: {
        OR: [
          {
            system_login: {
              none: {}, // ไม่มี system_login
            },
          },
          {
            system_login: {
              some: {
                // มี system_login ที่ id ตรงกับ Number(id)
                id: (id !== undefined && id !== null) ? Number(id) : -1,
              },
            },
          },
        ],
      },
      orderBy: {
        id: 'asc',
      },
    });
    return systemLoginRole;
  }

  async systemLoginOne(id: any) {
    const systemLogin = await this.prisma.system_login.findUnique({
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
        id: (id !== undefined && id !== null) ? Number(id) : -1,
      },
    });
    return systemLogin;
  }

  async systemLoginConfig(payload: any, userId: any) {
    try {
      if (!payload) {
        throw new HttpException('Payload is required', HttpStatus.BAD_REQUEST);
      }
      const { system_login_account, mode_account_id, role_id, ...dataWithout } =
        payload;
      const roleMasterCreate = await this.prisma.system_login.create({
        data: {
          // ...dataWithout,
          role: role_id ? {
            connect: {
              id: Number(role_id),
            },
          } : undefined,
          mode_account: mode_account_id ? {
            connect: {
              id: Number(mode_account_id),
            },
          } : undefined,
          active: true,
          create_date: getTodayNowAdd7().toDate(),
          // create_by: Number(userId),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });
      if (payload?.system_login_account?.length > 0) {
        const newAcc = [];
        for (let i = 0; i < payload?.system_login_account.length; i++) {
          //
          await this.prisma.system_login_account.create({
            data: {
              account_id: payload?.system_login_account[i]?.account_id ? Number(payload?.system_login_account[i]?.account_id) : 0,
              system_login_id: roleMasterCreate?.id,
              create_date: getTodayNowAdd7().toDate(),
              create_by: Number(userId),
            },
          });

          let account = null;
          if (mode_account_id === 2) {
            const nowAt30 = getTodayNowAdd7().add(30, 'minute').toDate();

            if (system_login_account[i].mode_account_id === 1) {
              // เก่า sso
              const pass = generatePassword(10);
              const hashPassword =
                await genPass(pass);
              const passwords = hashPassword?.hash;
              account = {
                password_gen_origin: pass,
                password_gen_flag: true,
                password: passwords,
                pass_gen_date: nowAt30,
              };
            } else {
              // เก่า local
              if (!system_login_account[i].password_gen_flag) {
                account = {
                  // password_gen_origin:
                  //   system_login_account[i].password_gen_origin,
                  // password_gen_flag: system_login_account[i].password_gen_flag,
                };
              } else {
                const pass = generatePassword(10);
                const hashPassword =
                  await genPass(pass);
                const passwords = hashPassword?.hash;
                account = {
                  password_gen_origin: pass,
                  password_gen_flag: true,
                  password: passwords,
                  pass_gen_date: nowAt30,
                };
              }
            }
          } else {
            // sso
            account = {
              password_gen_origin: null,
              password_gen_flag: null,
              password: null,
            };
          }

          await this.prisma.account.updateMany({
            where: {
              id: payload?.system_login_account[i]?.account_id ? Number(payload?.system_login_account[i]?.account_id) : 0,
            },
            data: {
              ...account,
            },
          });
          const { password, ...newAccount } = account;
          newAcc.push({
            account_id: payload?.system_login_account[i]?.account_id ? Number(payload?.system_login_account[i]?.account_id) : 0,
            ...newAccount,
          });

          await this.prisma.account_manage.updateMany({
            where: {
              account: {
                id: payload?.system_login_account[i]?.account_id ? Number(payload?.system_login_account[i]?.account_id) : 0,
              },
            },
            data: {
              mode_account_id: mode_account_id,
            },
          });
        }

        return {
          data: roleMasterCreate,
          account: newAcc,
        };
      } else {
        return {
          data: roleMasterCreate,
          account: [],
        };
      }
    } catch (error) {
      if (error.code === 'P2002' && error.meta?.target.includes('name')) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: 'name',
            error: 'Role name already exists. Please choose another name.',
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

  async systemLoginConfigEdit(id: any, payload: any, userId: any, req: any) {
    try {
      if (!payload) {
        throw new HttpException('Payload is required', HttpStatus.BAD_REQUEST);
      }
      const { system_login_account, ...dataWithout } = payload;
      const roleMasterUpdate = await this.prisma.system_login.update({
        where: {
          id: (id !== undefined && id !== null) ? Number(id) : -1,
        },
        data: {
          mode_account_id: dataWithout?.mode_account_id ? Number(dataWithout?.mode_account_id) : undefined,
          // ...dataWithout,
          update_date: getTodayNowAdd7().toDate(),
          update_by: Number(userId),
        },
      });
      let account = null;
      const newSystemAccount = [];
      const newAcc = [];
      if (system_login_account?.length > 0) {
        const sysAccount = await this.prisma.system_login_account.findMany({
          where: { system_login_id: (id !== undefined && id !== null) ? Number(id) : -1 },
        });
        for (let i = 0; i < system_login_account.length; i++) {
          const findId = sysAccount.filter((f: any) => {
            return f?.system_login_id === ((id !== undefined && id !== null) ? Number(id) : -1);
          });
          const find = findId.find((f: any) => {
            return f?.account_id === system_login_account[i]?.account_id;
          });

          newSystemAccount.push({
            account_id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
            system_login_id: (id !== undefined && id !== null) ? Number(id) : -1,
            update_date: find ? getTodayNowAdd7().toDate() : null,
            update_by: find ? Number(userId) : null,
            create_date: find
              ? find?.create_date
              : getTodayNowAdd7().toDate(),
            // create_by: !!find ? find?.create_by : Number(userId),
            create_by_account: {
              connect: {
                id: find ? find?.create_by : Number(userId),
              },
            },
            active: true,
          });
        }
        await this.prisma.system_login_account.deleteMany({
          where: { system_login_id: (id !== undefined && id !== null) ? Number(id) : -1 },
        });
        newSystemAccount.map(async (e: any) => {
          const { account_id, system_login_id, update_by, ...newE } = e;
          await this.prisma.system_login_account.create({
            data: {
              ...newE,
              account: {
                connect: {
                  id: (account_id !== undefined && account_id !== null) ? Number(account_id) : -1,
                },
              },
              system_login: {
                connect: {
                  id: (system_login_id !== undefined && system_login_id !== null) ? Number(system_login_id) : -1,
                },
              },
            },
          });
          return e;
        });
      } else {
        await this.prisma.system_login_account.deleteMany({
          where: { system_login_id: (id !== undefined && id !== null) ? Number(id) : -1 },
        });
      }
      if (dataWithout?.mode_account_id === 1) {
        //sso
        account = {
          password_gen_origin: null,
          password_gen_flag: null,
          password: null,
        };
        if (system_login_account?.length > 0) {
          for (let i = 0; i < system_login_account.length; i++) {
            await this.prisma.account.updateMany({
              where: {
                id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
              },
              data: {
                ...account,
              },
            });
            const { password, ...newAccount } = account;
            newAcc.push({
              account_id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
              ...newAccount,
            });

            await this.prisma.account_manage.updateMany({
              where: {
                account: {
                  id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
                },
              },
              data: {
                mode_account_id: dataWithout?.mode_account_id,
              },
            });
            const accountOne =
              await this.accountManageService.accountLocalGetSure(
                system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
              );
            await writeReq(
              this.prisma,
              'DAM',
              req,
              `account`,
              'change',
              accountOne,
            );
          }
          return {
            data: roleMasterUpdate,
            account: newAcc,
          };
        } else {
          return {
            data: roleMasterUpdate,
            account: [],
          };
        }
      } else {
        //local
        if (system_login_account?.length > 0) {
          for (let i = 0; i < system_login_account.length; i++) {
            if (!system_login_account[i].password_gen_flag) {
              // local เก่า
              account = {
                // password_gen_origin:
                //   system_login_account[i].password_gen_origin,
                // password_gen_flag: system_login_account[i].password_gen_flag,
              };
              // console.log('system_login_account[i] : ', system_login_account[i]);
              // console.log('account : ', account);
            } else {
              // local ใหม่
              const nowAt30 = getTodayNowAdd7().add(30, 'minute').toDate();
              const pass = generatePassword(10);
              const hashPassword =
                await genPass(pass);
              const passwords = hashPassword?.hash;
              account = {
                password_gen_origin: pass,
                password_gen_flag: true,
                password: passwords,
                pass_gen_date: nowAt30,
              };
              const findAcc = await this.prisma.account.findUnique({
                where: { id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0 },
              });
            }
            await this.prisma.account.updateMany({
              where: {
                id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
              },
              data: {
                ...account,
              },
            });
            const { password, ...newAccount } = account;
            newAcc.push({
              account_id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
              ...newAccount,
            });

            await this.prisma.account_manage.updateMany({
              where: {
                account: {
                  id: system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
                },
              },
              data: {
                mode_account_id: dataWithout?.mode_account_id,
              },
            });
            const accountOne =
              await this.accountManageService.accountLocalGetSure(
                system_login_account[i]?.account_id ? Number(system_login_account[i]?.account_id) : 0,
              );
            await writeReq(
              this.prisma,
              'DAM',
              req,
              `account`,
              'change',
              accountOne,
            );
          }

          return {
            data: roleMasterUpdate,
            account: newAcc,
          };
        } else {
          console.log('22');
          return {
            data: roleMasterUpdate,
            account: [],
          };
        }
      }
    } catch (error) {
      if (error.code === 'P2002' && error.meta?.target.includes('name')) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: 'name',
            error: 'Role name already exists. Please choose another name.',
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
}
