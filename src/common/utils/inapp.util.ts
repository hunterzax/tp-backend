import axios from 'axios';

export async function middleNotiInapp(
  prisma: any,
  type: any,
  message: any,
  menus_id: number,
  priority?: number,
) {
  // return 
  console.log('noti : ', message);
  console.log('menus_id : ', menus_id);
  const roleMenuAllocationManagementNoticeInapp =
    await prisma.account.findMany({
      where: {
        id: {
          not: 99999,
        },
        account_manage: {
          some: {
            account_role: {
              some: {
                role: {
                  // user_type_id: 2,
                  menus_config: {
                    some: {
                      menus_id: menus_id || 0,
                      f_noti_inapp: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        telephone: true,
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
      orderBy: {
        id: 'asc',
      },
    });

  const nAccount = roleMenuAllocationManagementNoticeInapp?.map((e: any) => {
    const { account_manage, ...nE } = e;
    const role = account_manage?.[0]?.account_role?.[0]?.role?.name || null;
    return {
      ...nE,
      role_name: role || null,
    };
  });
  const emailArr = nAccount?.map((e: any) => e?.email);
  if (emailArr?.length > 0) {
    await providerNotiInapp(type, message, emailArr, priority);
  }
}

export async function providerNotiInapp(
  type: any,
  message: any,
  email: any,
  priority?: number,
) {
  try {
    console.log('----- email ', email);
  const data = JSON.stringify({
    extras: {
      email: email, // []
    },
    message: message || '', // msg
    priority: priority || 1,
    title: type || '', // module
  });

  const config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: `${process.env.IN_APP_URL}`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.IN_APP_URL_TOKEN}`,
    },
    data: data,
  };

  // basic safety: enforce http/https protocol for configured endpoint
  try {
    const u = new URL(String(process.env.IN_APP_URL));
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new Error('IN_APP_URL must use http/https');
    }
  } catch (e) {
    throw new Error(`Invalid IN_APP_URL: ${e?.message || 'unknown'}`);
  }

  const sendData = await axios.request(config);
  return sendData;
  } catch (error) {
    console.log('send noti inapp error : ', error);
  }
}

// https://docs.google.com/spreadsheets/d/18l5P9ldPdZdxG8XjZsOOWlS-ffNYMg7OwkVJS87ayl8/edit?gid=2007651369#gid=2007651369
// (รอเส้นจริงมา) DAM>Admintration // Division Master // Division was synced at {sync_time} // ได้รับทุกคนที่ถูก Check Box Notice Inapp (Role Management) ในเมนู Division Master
// (เสร็จ) DAM>Parameter // Zone // Area // Customer Type // Contract Point // Nomination Point // Metered Point // Concept Point // NON TPA Point // Config Master Path
// - capacity right template // Planning Deadline // Nomination Deadline // Email Management // Email Group For Event // System Parameter // Allocation Mode // HV for Operation Flow and Instructed Flow
// - user guide // metering checking condition // Terms & Condition



// await middleNotiInapp(
//       this.prisma,
//       'DAM',
//       `${his?.contract_point} was created active from ${getTodayNowAdd7(his?.contract_point_start_date).format('YYYY-MM-DD')} to ${(his?.contract_point_end_date && getTodayNowAdd7(his?.contract_point_end_date).format('YYYY-MM-DD')) || '-'}`,
//       23, // contract point menus_id
//       1,
//     );