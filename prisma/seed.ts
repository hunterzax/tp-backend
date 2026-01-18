import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

const tempsTable = require('../public/temps-table.json');

const prisma = new PrismaClient();

// สำหรับ Single Record Upsert
// async function upsertMenu(menu: any) {
//   console.log(`Upserting menu: ${menu.name}`);
//   return await prisma.menus.upsert({
//     where: {
//       id: menu.id,
//     },
//     update: {
//       name: menu.name,
//       seq: menu.seq,
//       parent: menu.parent,
//       default_f_view: menu.default_f_view,
//       default_f_create: menu.default_f_create,
//       default_f_edit: menu.default_f_edit,
//       default_f_import: menu.default_f_import,
//       default_f_export: menu.default_f_export,
//       default_f_approved: menu.default_f_approved,
//       default_b_manage: menu.default_b_manage,
//     },
//     create: menu,
//   });
// }

// สำหรับ Multiple Records Upsert
async function upsertMenus(menus: any[]) {
  console.log('Upserting menus...');

  const transactions = menus.map((menu) => {
    return prisma.menus.upsert({
      where: {
        id: menu.id,
      },
      update: {
        name: menu.name,
        seq: menu.seq,
        parent: menu.parent,
        default_f_view: menu.default_f_view,
        default_f_create: menu.default_f_create,
        default_f_edit: menu.default_f_edit,
        default_f_import: menu.default_f_import,
        default_f_export: menu.default_f_export,
        default_f_approved: menu.default_f_approved,
        default_b_manage: menu.default_b_manage,
      },
      create: menu,
    });
  });
  // console.log('transactions : ', transactions);
  // return transactions
  // ใช้ transaction เพื่อให้การ upsert ทั้งหมดสำเร็จหรือล้มเหลวพร้อมกัน
  return await prisma.$transaction(transactions);
}

// const superAdmin = (): any => ({
//   id: 1,
//   email: 'super.admin@nx.com',
//   password: '1234',
//   // posts: {
//   //   create: [
//   //     {
//   //       id:1,
//   //       title: 'Follow Prisma on Twitter',
//   //       content: 'https://twitter.com/prisma',
//   //       published: true,
//   //     },
//   //     {
//   //       id:2,
//   //       title: 'Follow Nexus on Twitter',
//   //       content: 'https://twitter.com/nexusgql',
//   //       published: true,
//   //     },
//   //   ],
//   // },
// });

// const superAdmin = (): any => ({
//   id: 1,
//   email: 'super.admin@nx.com',
//   password: '1234',
//   // posts: {
//   //   create: [
//   //     {
//   //       id:1,
//   //       title: 'Follow Prisma on Twitter',
//   //       content: 'https://twitter.com/prisma',
//   //       published: true,
//   //     },
//   //     {
//   //       id:2,
//   //       title: 'Follow Nexus on Twitter',
//   //       content: 'https://twitter.com/nexusgql',
//   //       published: true,
//   //     },
//   //   ],
//   // },
// });

// admin@nueamek.fun
// $2b$10$fLz/0wbe1HZ1FevjhT4peux9iPMPdmtqr0cyNaVnl6RXvLwXtCri6
// 1726542675
// 2024-09-17T10:11:15.916Z
async function main() {
  dotenv.config();
  // console.log('Seeding... t_and_c');
  // await prisma.t_and_c.createMany({
  //   data: tempsTable?.t_and_c,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... type_account');
  // await prisma.type_account.createMany({
  //   data: tempsTable?.type_account,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... mode_account');
  // await prisma.mode_account.createMany({
  //   data: tempsTable?.mode_account,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... user_type');
  // await prisma.user_type.createMany({
  //   data: tempsTable?.user_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... bank master');
  // await prisma.bank_master.createMany({
  //   data: tempsTable?.bank_master,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  //   console.log('Seeding... account');
  // await prisma.account.createMany({
  //   data: tempsTable?.account,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... column_table');
  // await prisma.column_table.createMany({
  //   data: tempsTable?.column_table,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... column_field');
  // await prisma.column_field.createMany({
  //   data: tempsTable?.column_field,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... tso group');
  // await prisma.column_table_config.createMany({
  //   data: tempsTable?.column_table_config_tso_group,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... shipper group');
  // await prisma.column_table_config.createMany({
  //   data: tempsTable?.column_table_config_shipper_group,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... other group');
  // await prisma.column_table_config.createMany({
  //   data: tempsTable?.column_table_config_other_group,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... division');
  // await prisma.column_table_config.createMany({
  //   data: tempsTable?.column_table_config_division,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... system login');
  // await prisma.column_table_config.createMany({
  //   data: tempsTable?.column_table_config_system_login,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... users');
  // await prisma.column_table_config.createMany({
  //   data: tempsTable?.column_table_config_users,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... role');
  // await prisma.role.createMany({
  //   data: tempsTable?.role,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... group');
  // await prisma.group.createMany({
  //   data: tempsTable?.group,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... role_default');
  // await prisma.role_default.createMany({
  //   data: tempsTable?.role_default,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... division');
  // await prisma.division.createMany({
  //   data: tempsTable?.division,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... menus');
  // await prisma.menus.createMany({
  //   data: tempsTable?.menus,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // *** เรียกใช้งาน upsert menus
  // await upsertMenus(tempsTable.menus);

  // X console.log('Seeding... menus_config');
  // const menuExists = await prisma.menus.findMany({ orderBy:{ id:"asc" } });
  // for (let i = 0; i < tempsTable?.role.length; i++) {
  //   const configMenu = await menuExists.map((e: any) => {
  //     return {
  //       role_id: tempsTable?.role[i]?.id,
  //       menus_id: e?.id,
  //       f_view: tempsTable?.role[i]?.id === 1 ? 1 : e?.default_f_view,
  //       f_create: tempsTable?.role[i]?.id === 1 ? 1 : e?.default_f_create,
  //       f_edit: tempsTable?.role[i]?.id === 1 ? 1 : e?.default_f_edit,
  //       f_import:
  //         e?.default_f_import === 2
  //           ? 2
  //           : tempsTable?.role[i]?.id === 1
  //             ? 1
  //             : e?.default_f_import,
  //       f_export:
  //         e?.default_f_export === 2
  //           ? 2
  //           : tempsTable?.role[i]?.id === 1
  //             ? 1
  //             : e?.default_f_export,
  //       f_approved:
  //         e?.default_f_approved === 2
  //           ? 2
  //           : tempsTable?.role[i]?.id === 1
  //             ? 1
  //             : e?.default_f_approved,
  //       b_manage: tempsTable?.role[i]?.id === 1 ? true : !!e?.default_b_manage,
  //     };
  //   });
  //   await prisma.menus_config.createMany({
  //     data: configMenu,
  //     skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  //   });
  // }
  // X

  // *** console.log('Seeding... menus_config new');
  // const menuExists = await prisma.menus.findMany({ orderBy: { id: 'asc' } });
  // const roleId = await prisma.role.findMany();

  // for (let i = 0; i < roleId.length; i++) {
  //   // ดึงข้อมูล menus_id ทั้งหมดใน menus_config
  //   const existingMenusConfig = await prisma.menus_config.findMany({
  //     where: {
  //       role_id: roleId[i]?.id,
  //     },
  //     select: {
  //       menus_id: true,
  //       seq: true,
  //       parent: true,
  //     },
  //   });

  //   // แปลง existingMenusConfig เป็น Array ของ menus_id
  //   const existingMenusIds = existingMenusConfig.map(
  //     (config) => config.menus_id,
  //   );

  //   // กรองเฉพาะรายการที่ยังไม่มี menus_id ในฐานข้อมูล
  //   const configMenuToCreate = menuExists
  //     .filter((menu) => !existingMenusIds.includes(menu.id)) // กรองเฉพาะที่ยังไม่มี menus_id
  //     .map((menu: any) => {
  //       return {
  //         role_id: roleId[i]?.id,
  //         menus_id: menu?.id,
  //         f_view: roleId[i]?.id === 1 ? 1 : menu?.default_f_view,
  //         f_create: roleId[i]?.id === 1 ? 1 : menu?.default_f_create,
  //         f_edit: roleId[i]?.id === 1 ? 1 : menu?.default_f_edit,
  //         f_import:
  //           menu?.default_f_import === 2
  //             ? 2
  //             : roleId[i]?.id === 1
  //               ? 1
  //               : menu?.default_f_import,
  //         f_export:
  //           menu?.default_f_export === 2
  //             ? 2
  //             : roleId[i]?.id === 1
  //               ? 1
  //               : menu?.default_f_export,
  //         f_approved:
  //           menu?.default_f_approved === 2
  //             ? 2
  //             : roleId[i]?.id === 1
  //               ? 1
  //               : menu?.default_f_approved,
  //         b_manage: roleId[i]?.id === 1 ? true : !!menu?.default_b_manage,
  //         seq: menu?.seq,
  //         parent: menu?.parent,
  //       };
  //     });

  //   // อัปเดตฟิลด์ seq และ parent สำหรับ menus_id ที่มีอยู่แล้ว
  //   const updatePromises = existingMenusConfig.map((existingMenu) =>
  //     prisma.menus_config.updateMany({
  //       where: {
  //         menus_id: existingMenu.menus_id,
  //         role_id: roleId[i]?.id,
  //       },
  //       data: {
  //         seq:
  //           menuExists.find((menu) => menu.id === existingMenu.menus_id)?.seq ||
  //           null,
  //         parent:
  //           menuExists.find((menu) => menu.id === existingMenu.menus_id)
  //             ?.parent || null,
  //       },
  //     }),
  //   );
  //   await Promise.all(updatePromises); // รันคำสั่ง update แบบพร้อมกัน

  //   // สร้างข้อมูลใหม่ที่กรองแล้ว
  //   if (configMenuToCreate.length > 0) {
  //     await prisma.menus_config.createMany({
  //       data: configMenuToCreate,
  //       skipDuplicates: true,
  //     });
  //   }
  // }
  // *****-


  // // // ---- create menu
  // // console.log('Seeding... menu new'); config
  // const menuExists = await prisma.menus.findMany({ orderBy: { id: 'asc' } });
  // const configMenuToCreate = tempsTable?.menus.filter((menu) => !menuExists?.map((e:any) => e?.id).includes(menu.id)) // กรองเฉพาะที่ยังไม่มี menus_id
  // const configMenuToUpdate = tempsTable?.menus.filter((menu) => menuExists?.map((e:any) => e?.id).includes(menu.id)) // กรองเฉพาะที่ยังไม่มี menus_id
  // let arrMenu = []
  // for (let i = 0; i < configMenuToUpdate.length; i++) {
  //   const menu = configMenuToUpdate[i]
  //   arrMenu.push({
  //     id: menu?.id,

  //     default_f_view: menu?.default_f_view,
  //     default_f_create: menu?.default_f_create,
  //     default_f_edit: menu?.default_f_edit,
  //     default_f_import: menu?.default_f_import,
  //     default_f_export: menu?.default_f_export,
  //     default_f_approved: menu?.default_f_approved,
  //     default_f_noti_email: menu?.default_f_noti_email,
  //     default_f_noti_inapp: menu?.default_f_noti_inapp,
  //     default_b_manage: menu?.default_b_manage,

  //     tso_default_f_view: menu?.tso_default_f_view,
  //     tso_default_f_create: menu?.tso_default_f_create,
  //     tso_default_f_edit: menu?.tso_default_f_edit,
  //     tso_default_f_import: menu?.tso_default_f_import,
  //     tso_default_f_export: menu?.tso_default_f_export,
  //     tso_default_f_approved: menu?.tso_default_f_approved,
  //     tso_default_f_noti_email: menu?.tso_default_f_noti_email,
  //     tso_default_f_noti_inapp: menu?.tso_default_f_noti_inapp,
  //     tso_default_b_manage: menu?.tso_default_b_manage,

  //     shipper_default_f_view: menu?.shipper_default_f_view,
  //     shipper_default_f_create: menu?.shipper_default_f_create,
  //     shipper_default_f_edit: menu?.shipper_default_f_edit,
  //     shipper_default_f_import: menu?.shipper_default_f_import,
  //     shipper_default_f_export: menu?.shipper_default_f_export,
  //     shipper_default_f_approved: menu?.shipper_default_f_approved,
  //     shipper_default_f_noti_email: menu?.shipper_default_f_noti_email,
  //     shipper_default_f_noti_inapp: menu?.shipper_default_f_noti_inapp,
  //     shipper_default_b_manage: menu?.shipper_default_b_manage,

  //     other_default_f_view: menu?.other_default_f_view,
  //     other_default_f_create: menu?.other_default_f_create,
  //     other_default_f_edit: menu?.other_default_f_edit,
  //     other_default_f_import: menu?.other_default_f_import,
  //     other_default_f_export: menu?.other_default_f_export,
  //     other_default_f_approved: menu?.other_default_f_approved,
  //     other_default_f_noti_email: menu?.other_default_f_noti_email,
  //     other_default_f_noti_inapp: menu?.other_default_f_noti_inapp,
  //     other_default_b_manage: menu?.other_default_b_manage,

  //   })
   
  // }
  // const updatePromises = arrMenu.map((existingMenu) =>{
  //   const { id, ...nexistingMenu } = existingMenu
  //   return (prisma.menus.updateMany({
  //     where: {
  //       id: id
  //     },
  //     data: {
  //      ...nexistingMenu,
  //     },
  //   }))
  // }
  // );
  
  // await Promise.all(updatePromises); // รันคำสั่ง update แบบพร้อมกัน

  //  if (configMenuToCreate.length > 0) {
  //     await prisma.menus.createMany({
  //       data: configMenuToCreate,
  //       skipDuplicates: true,
  //     });
  //   }

  // // ----

  // console.log('Seeding... account_manage');
  // await prisma.account_manage.createMany({
  //   data: tempsTable?.account_manage,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... account_role');
  // await prisma.account_role.createMany({
  //   data: tempsTable?.account_role,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... entry_exit');
  // await prisma.entry_exit.createMany({
  //   data: tempsTable?.entry_exit,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... zone');
  // await prisma.zone.createMany({
  //   data: tempsTable?.zone,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... sub_system_parameter');
  // await prisma.sub_system_parameter.createMany({
  //   data: tempsTable?.sub_system_parameter,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... sub_email_notification_management');
  // await prisma.sub_email_notification_management.createMany({
  //   data: tempsTable?.sub_email_notification_management,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... term_type');
  // await prisma.term_type.createMany({
  //   data: tempsTable?.term_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... process_type');
  // await prisma.process_type.createMany({
  //   data: tempsTable?.process_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... status_capacity_request_management');
  // await prisma.status_capacity_request_management.createMany({
  //   data: tempsTable?.status_capacity_request_management,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... status_capacity_request_management_process');
  // await prisma.status_capacity_request_management_process.createMany({
  //   data: tempsTable?.status_capacity_request_management_process,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... release_capacity_status');
  // await prisma.release_capacity_status.createMany({
  //   data: tempsTable?.release_capacity_status,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... release_type');
  // await prisma.release_type.createMany({
  //   data: tempsTable?.release_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });

  // console.log('Seeding... type_concept_point');
  // await prisma.type_concept_point.createMany({
  //   data: tempsTable?.type_concept_point,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });

  // console.log('Seeding... query_shipper_nomination_type');
  // await prisma.query_shipper_nomination_type.createMany({
  //   data: tempsTable?.query_shipper_nomination_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... query_shipper_nomination_status');
  // await prisma.query_shipper_nomination_status.createMany({
  //   data: tempsTable?.query_shipper_nomination_status,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... query_shipper_nomination_file_renom');
  // await prisma.query_shipper_nomination_file_renom.createMany({
  //   data: tempsTable?.query_shipper_nomination_file_renom,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... query_shipper_nomination_type_comment');
  // await prisma.query_shipper_nomination_type_comment.createMany({
  //   data: tempsTable?.query_shipper_nomination_type_comment,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... daily_adjustment_status');
  // await prisma.daily_adjustment_status.createMany({
  //   data: tempsTable?.daily_adjustment_status,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... allocation_mode_type');
  // await prisma.allocation_mode_type.createMany({
  //   data: tempsTable?.allocation_mode_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... allocation_status');
  // await prisma.allocation_status.createMany({
  //   data: tempsTable?.allocation_status,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... curtailments_allocation_type');
  // await prisma.curtailments_allocation_type.createMany({
  //   data: tempsTable?.curtailments_allocation_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... hv_type');
  // await prisma.hv_type.createMany({
  //   data: tempsTable?.hv_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_status');
  // await prisma.event_status.createMany({
  //   data: tempsTable?.event_status,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_status');
  // await prisma.event_doc_status.createMany({
  //   data: tempsTable?.event_doc_status,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_master');
  // await prisma.event_doc_master.createMany({
  //   data: tempsTable?.event_doc_master,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_emer_type');
  // await prisma.event_doc_emer_type.createMany({
  //   data: tempsTable?.event_doc_emer_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_emer_gas_tranmiss');
  // await prisma.event_doc_emer_gas_tranmiss.createMany({
  //   data: tempsTable?.event_doc_emer_gas_tranmiss,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_emer_order');
  // await prisma.event_doc_emer_order.createMany({
  //   data: tempsTable?.event_doc_emer_order,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_ofo_type');
  // await prisma.event_doc_ofo_type.createMany({
  //   data: tempsTable?.event_doc_ofo_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_ofo_gas_tranmiss');
  // await prisma.event_doc_ofo_gas_tranmiss.createMany({
  //   data: tempsTable?.event_doc_ofo_gas_tranmiss,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_ofo_order');
  // await prisma.event_doc_ofo_order.createMany({
  //   data: tempsTable?.event_doc_ofo_order,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... event_doc_ofo_refer');
  // await prisma.event_doc_ofo_refer.createMany({
  //   data: tempsTable?.event_doc_ofo_refer,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... tariff_type_charge');
  // await prisma.tariff_type_charge.createMany({
  //   data: tempsTable?.tariff_type_charge,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... tariff_type');
  // await prisma.tariff_type.createMany({
  //   data: tempsTable?.tariff_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... tariff_invoice_sent');
  // await prisma.tariff_invoice_sent.createMany({
  //   data: tempsTable?.tariff_invoice_sent,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... tariff_type_ab');
  // await prisma.tariff_type_ab.createMany({
  //   data: tempsTable?.tariff_type_ab,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // console.log('Seeding... tariff_credit_debit_note_type');
  // await prisma.tariff_credit_debit_note_type.createMany({
  //   data: tempsTable?.tariff_credit_debit_note_type,
  //   skipDuplicates: true, // ข้ามข้อมูลที่ซ้ำกัน (ออปชันนี้หากต้องการ)
  // });
  // ******

  


}
// docker build -t go-mail:1 --platform linux/amd64 .
main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });


  // query_shipper_nomination_file_renom

  // zone