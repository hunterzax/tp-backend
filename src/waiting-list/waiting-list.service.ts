import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { AllocationService } from 'src/allocation/allocation.service';
import { getTodayNowAdd7 } from 'src/common/utils/date.util';
import { groupDataAlloManage } from 'src/common/utils/allcation.util';
import { EventService } from 'src/event/event.service';
import { countWaitingDocuments, FINISHED_STATUS_IDS, getAllocationDateRange, getEventDateRange, CAPACITY_CONTRACT, RELEASE_CAPACITY, NOMINATION, NOMINATION_ADJUSTMENT, ALLOCATION_REVIEW, ALLOCATION_MANAGEMENT, EVENT_OFFSPEC_GAS, EVENT_EMERGENCY_DIFFICULT_DAY, EVENT_OF_IF, WAITING_LIST_TARGET_MENUS, NOMINATION_DAILY_MANAGEMENT, NOMINATION_QUERY, NOMINATION_WEEKLY_MANAGEMENT, CAPACITY_CONTRACT_MANAGEMENT, CAPACITY_CONTRACT_LIST } from 'src/common/utils/waiting-list.util';
import { Prisma } from '@prisma/client';
import { getGroupData } from 'src/common/utils/group.util';

@Injectable()
export class WaitingListService {

  constructor(
    private prisma: PrismaService,
    private readonly allocationService: AllocationService,
    private readonly eventService: EventService
  ) {}

  // Helper method to get event data with pagination
  private async getEventData(
    eventMethod: 'offspecGasAll' | 'emerAll' | 'ofoAll',
    eventDateFrom: string,
    eventDateTo: string,
    userId: any
  ) {
    let total = 1;
    let result: any = {};
    
    for (let i = 0; i < 2; i++) {
      result = await this.eventService[eventMethod]({
        eventCode: '',
        eventDateFrom,
        eventDateTo,
        EventStatus: '1',
        offset: '0',
        limit: `${total}`,
      }, userId);
      total = result?.total ?? 1;
    }
    
    return result;
  }

  async getMenuConfigsByUserIdAndMenuId(userId: any, menuId: number[], atDate?: any) {
    try {
      const date = getTodayNowAdd7(atDate).toDate();
      const menuConfigs = await this.prisma.menus_config.findMany({
        where: {
          menus_id: {
            in: menuId,
          },
          role: {
            account_role: {
              some: {
                account_manage: {
                  account_id: Number(userId),
                },
              },
            },
            start_date: { lte: date },
            OR: [
              { end_date: null },
              { end_date: { gt: date } },
            ],
          },
          f_view: 1,
          b_manage: true,
        },
        include: {
          menus: true,
        },
      });

      return menuConfigs;
    } catch (error) {
      return [];
    }
  }

  async getWaitingListMenu({
    userId,
    targetMenus,
    atDate,
  }: {
    userId: any;
    targetMenus: WAITING_LIST_TARGET_MENUS[];
    atDate?: any;
  }) {
    try {
      const menu : WAITING_LIST_TARGET_MENUS[] = []
      
      if(targetMenus.includes(CAPACITY_CONTRACT)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [50], atDate)).length > 0){
          menu.push(CAPACITY_CONTRACT_MANAGEMENT)
        }
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [53], atDate)).length > 0){
          menu.push(CAPACITY_CONTRACT_LIST)
        }
      }

      if(targetMenus.includes(RELEASE_CAPACITY)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [60], atDate)).length > 0){
          menu.push(RELEASE_CAPACITY)
        }
      }

      if(targetMenus.includes(NOMINATION)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [64], atDate)).length > 0){
          menu.push(NOMINATION_QUERY)
        }
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [65], atDate)).length > 0){
          menu.push(NOMINATION_DAILY_MANAGEMENT)
        }
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [66], atDate)).length > 0){
          menu.push(NOMINATION_WEEKLY_MANAGEMENT)
        }
      }

      if(targetMenus.includes(NOMINATION_ADJUSTMENT)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [66], atDate)).length > 0){
          menu.push(NOMINATION_ADJUSTMENT)
        }
      }

      if(targetMenus.includes(ALLOCATION_REVIEW)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [81], atDate)).length > 0){
          menu.push(ALLOCATION_REVIEW)
        }
      }

      if(targetMenus.includes(ALLOCATION_MANAGEMENT)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [82], atDate)).length > 0){
          menu.push(ALLOCATION_MANAGEMENT)
        }
      }

      if(targetMenus.includes(EVENT_OFFSPEC_GAS)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [107], atDate)).length > 0){
          menu.push(EVENT_OFFSPEC_GAS)
        }
      }

      if(targetMenus.includes(EVENT_EMERGENCY_DIFFICULT_DAY)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [106], atDate)).length > 0){
          menu.push(EVENT_EMERGENCY_DIFFICULT_DAY)
        }
      }

      if(targetMenus.includes(EVENT_OF_IF)){
        if((await this.getMenuConfigsByUserIdAndMenuId(userId, [1013], atDate)).length > 0){
          menu.push(EVENT_OF_IF)
        }
      }

      return menu;
    } catch (error) {
      return [];
    }
  }

  async getAllocationFromAllocationService(
    userId: any,
    shipper: string[],
    startDate?: string,
    endDate?: string,
  ) {
    try {
      let result = await this.allocationService.allocationManagementNew(
        {
          start_date: startDate,
          end_date: endDate,
          skip: 0,
          limit: 0,
        },
        userId,
      );

      if (shipper.length > 0) {
        result = result.filter((f: any) => shipper.includes(f?.shipper));
      }

      return result;
    } catch (error) {
      return [];
    }
  }

  async getAllocationReviewData({
    userId,
    shipper,
    startDate,
    endDate,
    data,
    menu,
    atDate,
  }: {
    userId: any;
    shipper: string[];
    startDate?: string;
    endDate?: string;
    data?: any[];
    menu: WAITING_LIST_TARGET_MENUS[];
    atDate?: any;
  }) {
    if(menu.includes(ALLOCATION_REVIEW)){
      const { startDate: start, endDate: end } = getAllocationDateRange(atDate, startDate, endDate);
      
      try {
        const result = data || await this.getAllocationFromAllocationService(
          userId,
          shipper,
          startDate,
          endDate,
        );
  
        return {
          startDate: start,
          endDate: end,
          remainingTasks: result.filter((f: any) => f?.allocation_status?.id === 2).length,
        };
      } catch (error) {
        return {
          startDate: start,
          endDate: end,
          remainingTasks: 0,
        };
      }
    }
    else{
      return undefined;
    }
  }

  async getAllocationManagementData({
    userId,
    shipper,
    startDate,
    endDate,
    data,
    menu,
    atDate,
  }: {
    userId: any;
    shipper: string[];
    startDate?: string;
    endDate?: string;
    data?: any[];
    menu: WAITING_LIST_TARGET_MENUS[];
    atDate?: any;
  }) {
    if(menu.includes(ALLOCATION_MANAGEMENT)){
      const { startDate: start, endDate: end } = getAllocationDateRange(atDate, startDate, endDate);
      
      try {
        let result = data || await this.getAllocationFromAllocationService(userId, shipper, start, end);
        result = groupDataAlloManage(result);
    
        return {
          startDate: start,
          endDate: end,
          remainingTasks: result.filter((f: any) => f?.priorityStatus === 2).length,
        };
      } catch (error) {
        return {
          startDate: start,
          endDate: end,
          remainingTasks: 0,
        };
      }
    }
    else{
      return undefined;
    }
  }

  async getOffspecGasData({
    userId,
    shipper,
    tso,
    menu,
    atDate,
  }: {
    userId: any;
    shipper: number[];
    tso: number[];
    menu: WAITING_LIST_TARGET_MENUS[];
    atDate?: any;
  }) {
    if(menu.includes(EVENT_OFFSPEC_GAS)){
      const { eventDateFrom, eventDateTo } = getEventDateRange(atDate);

      try {
        const result = await this.getEventData('offspecGasAll', eventDateFrom, eventDateTo, userId);
        
        let count = 0;
        
        result?.data?.forEach((item: any) => {
          // Document1 - TSO specific
          if (item?.document1 && !FINISHED_STATUS_IDS.includes(item.document1?.event_doc_status?.id)) {
            count += countWaitingDocuments([item.document1], tso);
          }
  
          // Document2 - Shipper specific
          count += countWaitingDocuments(item?.document2, shipper);
  
          // Document3 - Shipper specific
          count += countWaitingDocuments(item?.document3, shipper);
        });
  
        return {
          startDate: eventDateFrom,
          endDate: eventDateTo,
          remainingTasks: count,
        };
      } catch (error) {
        return {
          startDate: eventDateFrom,
          endDate: eventDateTo,
          remainingTasks: 0,
        };
      }
    }
    else{
      return undefined;
    }
  }

  async getEmerData({
    userId,
    shipper,
    tso,
    menu,
    atDate,
  }: {
    userId: any;
    shipper: number[];
    tso: number[];
    menu: WAITING_LIST_TARGET_MENUS[];
    atDate?: any;
  }) {
    const { eventDateFrom, eventDateTo } = getEventDateRange(atDate);

    if(menu.includes(EVENT_EMERGENCY_DIFFICULT_DAY)){
      try {
        const result = await this.getEventData('emerAll', eventDateFrom, eventDateTo, userId);
        
        let count = 0;
        
        result?.data?.forEach((item: any) => {
          // Document39 - Shipper specific
          count += countWaitingDocuments(item?.document39, shipper);
  
          // Document41 - Shipper specific
          count += countWaitingDocuments(item?.document41, shipper);
  
          // Document5 - Shipper specific
          count += countWaitingDocuments(item?.document5, shipper);
  
          // Document6 - Shipper specific
          count += countWaitingDocuments(item?.document6, shipper);
        });
  
        return {
          startDate: eventDateFrom,
          endDate: eventDateTo,
          remainingTasks: count,
        };
      } catch (error) {
        return {
          startDate: eventDateFrom,
          endDate: eventDateTo,
          remainingTasks: 0,
        };
      }
    }
    else{
      return undefined;
    }
  }

  async getOfoData({
    userId,
    shipper,
    tso,
    menu,
    atDate,
  }: {
    userId: any;
    shipper: number[];
    tso: number[];
    menu: WAITING_LIST_TARGET_MENUS[];
    atDate?: any;
  }) {
    const { eventDateFrom, eventDateTo } = getEventDateRange(atDate);

    if(menu.includes(EVENT_OF_IF)){
      try {
        const result = await this.getEventData('ofoAll', eventDateFrom, eventDateTo, userId);
        
        let count = 0;
        
        result?.data?.forEach((item: any) => {
          // Document7 - Shipper specific
          count += countWaitingDocuments(item?.document7, shipper);
  
          // Document8 - Shipper specific
          count += countWaitingDocuments(item?.document8, shipper);
        });
  
        return {
          startDate: eventDateFrom,
          endDate: eventDateTo,
          remainingTasks: count,
        };
      } catch (error) {
        return {
          startDate: eventDateFrom,
          endDate: eventDateTo,
          remainingTasks: 0,
        };
      }
    }
    else{
      return undefined;
    }
  }

  async getNominationData(
    shipper: number[],
    menu: WAITING_LIST_TARGET_MENUS[],
    // atDate?: any
  ) {
    if(menu.includes(NOMINATION_QUERY) || menu.includes(NOMINATION_DAILY_MANAGEMENT) || menu.includes(NOMINATION_WEEKLY_MANAGEMENT)){
      const returnObj = {}
      returnObj["Daily Query Shipper Nomination File"] = undefined
      returnObj["Weekly Query Shipper Nomination File"] = undefined
      returnObj[NOMINATION_DAILY_MANAGEMENT] = undefined;
      returnObj[NOMINATION_WEEKLY_MANAGEMENT] = undefined;

      try {
        // const date = getTodayNowAdd7(atDate).toDate();
        // const { weekStart: targetWeekStart, weekEnd: targetWeekEnd } = getWeekRange(date);
        const andInWhere : Prisma.query_shipper_nomination_fileWhereInput[] = [
          // Waiting For Response
          {
            query_shipper_nomination_status: {
              id: 1,
            },
          },
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
          // {
          //   OR: [
          //     // Daily nominations: exact date match
          //     {
          //       nomination_type: {
          //         id: 1,
          //       },
          //       gas_day: date,
          //     },
          //     // Weekly nominations: same week
          //     {
          //       nomination_type: {
          //         id: 2,
          //       },
          //       gas_day: {
          //         gte: targetWeekStart,
          //         lte: targetWeekEnd,
          //       },
          //     },
          //   ],
          // },
        ]
        if(shipper.length > 0) {
          andInWhere.push(
            {
              group_id: {
                in: shipper,
              }
            }
          )
        }
        const result = await this.prisma.query_shipper_nomination_file.findMany({
          where: {
            AND: andInWhere,
          },
        });
  
        const daily = result.filter((f: any) => f?.nomination_type_id === 1).length;
        const weekly = result.filter((f: any) => f?.nomination_type_id === 2).length;


        if(menu.includes(NOMINATION_QUERY)){
          returnObj["Daily Query Shipper Nomination File"] = {
            remainingTasks: daily,
          }
          returnObj["Weekly Query Shipper Nomination File"] = {
            remainingTasks: weekly,
          }
        }
        if(menu.includes(NOMINATION_DAILY_MANAGEMENT)){
          returnObj[NOMINATION_DAILY_MANAGEMENT] = {
            remainingTasks: daily,
          }
        }
        if(menu.includes(NOMINATION_WEEKLY_MANAGEMENT)){
          returnObj[NOMINATION_WEEKLY_MANAGEMENT] = {
            remainingTasks: weekly,
          }
        }
      } catch (error) {
        if(menu.includes(NOMINATION_QUERY)){
          returnObj["Daily Query Shipper Nomination File"] = {
            remainingTasks: 0,
          }
          returnObj["Weekly Query Shipper Nomination File"] = {
            remainingTasks: 0,
          }
        }
        if(menu.includes(NOMINATION_DAILY_MANAGEMENT)){
          returnObj[NOMINATION_DAILY_MANAGEMENT] = {
            remainingTasks: 0,
          }
        }
        if(menu.includes(NOMINATION_WEEKLY_MANAGEMENT)){
          returnObj[NOMINATION_WEEKLY_MANAGEMENT] = {
            remainingTasks: 0,
          }
        }
      }

      return returnObj;
    }
    else{
      return undefined;
    }
  }

  async getNominationAdjustmentData(
    shipper: number[],
    menu: WAITING_LIST_TARGET_MENUS[],
    // atDate?: any
  ) {
    if(menu.includes(NOMINATION_ADJUSTMENT)){
      try {
        // const date = getTodayNowAdd7(atDate).toDate();
        const andInWhere : Prisma.daily_adjustmentWhereInput[] = [
          // Submitted
          {
            daily_adjustment_status_id: 1,
          }
        ]
        if(shipper.length > 0) {
          andInWhere.push(
            {
              daily_adjustment_group: {
                some: {
                  group_id: {
                    in: shipper
                  },
                },
              }
            }
          )
        }
        const result = await this.prisma.daily_adjustment.count({
          where: {
            AND: andInWhere,
          },
        });
  
        return {
          remainingTasks: result,
        };
      } catch (error) {
        return {
          remainingTasks: 0,
        };
      }
    }
    else{
      return undefined;
    }
  }

  async getContractData(
    shipper: number[],
    menu: WAITING_LIST_TARGET_MENUS[],
    // atDate?: any
  ) {
    
    if(menu.includes(CAPACITY_CONTRACT_MANAGEMENT) || menu.includes(CAPACITY_CONTRACT_LIST)){
      const returnObj = {}
      returnObj[CAPACITY_CONTRACT_LIST] = undefined;
      returnObj[CAPACITY_CONTRACT_MANAGEMENT] = undefined;
      
      try {
        // const date = getTodayNowAdd7(atDate).toDate();
        const andInWhere : Prisma.contract_codeWhereInput[] = [
          // Waiting For Approval
          {
            status_capacity_request_management_process_id: 3,
          }
        ]
        if(shipper.length > 0) {
          andInWhere.push(
            {
              group_id: {
                in: shipper
              }
            }
          )
        }
        
        const result = await this.prisma.contract_code.count({
          where: {
            AND: andInWhere,
          },
        });

        if(menu.includes(CAPACITY_CONTRACT_LIST)){
          returnObj[CAPACITY_CONTRACT_LIST] = {
            remainingTasks: result,
          }
        }
        if(menu.includes(CAPACITY_CONTRACT_MANAGEMENT)){
          returnObj[CAPACITY_CONTRACT_MANAGEMENT] = {
            remainingTasks: result,
          }
        }
  
      } catch (error) {
        if(menu.includes(CAPACITY_CONTRACT_LIST)){
          returnObj[CAPACITY_CONTRACT_LIST] = {
            remainingTasks: 0,
          }
        }
        if(menu.includes(CAPACITY_CONTRACT_MANAGEMENT)){
          returnObj[CAPACITY_CONTRACT_MANAGEMENT] = {
            remainingTasks: 0,
          }
        }
      }
    
      return returnObj;
    }
    else{
      return undefined;
    }
  }

  async getContractReleaseCapacityData(
    shipper: number[],
    menu: WAITING_LIST_TARGET_MENUS[],
    // atDate?: any
  ) {
    if(menu.includes(RELEASE_CAPACITY)){
      try {
        // const date = getTodayNowAdd7(atDate).toDate();
        const andInWhere : Prisma.release_capacity_submissionWhereInput[] = [
          // Submitted
          {
            release_capacity_status_id: 1,
          }
        ]
        if(shipper.length > 0) {
          andInWhere.push(
            {
              group_id: {
                in: shipper
              }
            }
          )
        }
        
        const result = await this.prisma.release_capacity_submission.count({
          where: {
            AND: andInWhere,
          },
        });
  
        return {
          remainingTasks: result,
        };
      } catch (error) {
        return {
          remainingTasks: 0,
        };
      }
    }
    else{
      return undefined;
    }
  }

  async findAllocationReview(payload: any, userId: any) {
    const { atDate } = payload;
    const { group, isAdmin } = await getGroupData(this.prisma, userId);
    const shipper = isAdmin ? [] : group.map((f: any) => f?.id_name);

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [ALLOCATION_REVIEW]
    });
    
    return await this.getAllocationReviewData({
      userId,
      shipper,
      menu,
      atDate
    });
  }

  async findAllocationManagement(payload: any, userId: any) {
    const { atDate } = payload;
    const { group, isAdmin } = await getGroupData(this.prisma, userId);
    const shipper = isAdmin ? [] : group.map((f: any) => f?.id_name);

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [ALLOCATION_MANAGEMENT]
    });
    
    return await this.getAllocationManagementData({
      userId,
      shipper,
      menu,
      atDate
    });
  }

  async findOffspecGas(payload: any, userId: any) {
    const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);
    const shipper = group.map((f: any) => f?.id);
    const tso = isTSO ? group.map((f: any) => f?.id) : isAdmin ? [] : [-1];

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [EVENT_OFFSPEC_GAS]
    });
    
    return await this.getOffspecGasData({
      userId,
      shipper,
      tso,
      menu,
      atDate
    });
  }

  async findEmer(payload: any, userId: any) {
    const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);
    const shipper = group.map((f: any) => f?.id);
    const tso = isTSO ? group.map((f: any) => f?.id) : isAdmin ? [] : [-1];

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [EVENT_EMERGENCY_DIFFICULT_DAY]
    });
    
    return await this.getEmerData({
      userId,
      shipper,
      tso,
      menu,
      atDate
    });
  }

  async findOfo(payload: any, userId: any) {
    const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);
    const shipper = group.map((f: any) => f?.id);
    const tso = isTSO ? group.map((f: any) => f?.id) : isAdmin ? [] : [-1];

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [EVENT_OF_IF]
    });
    
    return await this.getOfoData({
      userId,
      shipper,
      tso,
      menu,
      atDate
    });
  }

  async findNomination(payload: any, userId: any) {
    // const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);
    const shipper = (isAdmin || isTSO) ? [] : group.map((f: any) => f?.id);

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [NOMINATION]
    });
    
    return await this.getNominationData(shipper, menu);
  }

  async findNominationAdjustment(payload: any, userId: any) {
    // const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);
    const shipper = (isAdmin || isTSO) ? [] : group.map((f: any) => f?.id);

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [NOMINATION_ADJUSTMENT]
    });
    
    return await this.getNominationAdjustmentData(shipper, menu);
  }

  async findContract(payload: any, userId: any) {
    // const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);
    const shipper = (isAdmin || isTSO) ? [] : group.map((f: any) => f?.id);

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [CAPACITY_CONTRACT]
    });
    
    return await this.getContractData(shipper, menu);
  }

  async findContractReleaseCapacity(payload: any, userId: any) {
    // const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);
    const shipper = (isAdmin || isTSO) ? [] : group.map((f: any) => f?.id);

    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [RELEASE_CAPACITY]
    });
    
    return await this.getContractReleaseCapacityData(shipper, menu);
  }

  async findAll(payload: any, userId: any) {
    const { atDate } = payload;
    const { group, isAdmin, isTSO } = await getGroupData(this.prisma, userId);

    const shipper = (isAdmin || isTSO) ? [] : group.map((f: any) => f?.id);


    const menu : WAITING_LIST_TARGET_MENUS[] = await this.getWaitingListMenu({
      userId,
      targetMenus: [
        CAPACITY_CONTRACT,
        RELEASE_CAPACITY,
        NOMINATION,
        NOMINATION_ADJUSTMENT,
        ALLOCATION_REVIEW,
        ALLOCATION_MANAGEMENT,
        EVENT_OFFSPEC_GAS,
        EVENT_EMERGENCY_DIFFICULT_DAY,
        EVENT_OF_IF
      ],
      atDate
    });

    //#region contract
    const contract = await this.getContractData(shipper, menu);
    const contractReleaseCapacity = await this.getContractReleaseCapacityData(shipper, menu);
    //#endregion nomination

    //#region nomination
    const nomination = await this.getNominationData(shipper, menu);
    const nominationAdjustment = await this.getNominationAdjustmentData(shipper, menu);
    //#endregion nomination

    //#region allocation
    const { startDate: alloStartDate, endDate: alloEndDate } = getAllocationDateRange(atDate);
    const alloShipper = (isAdmin || isTSO) ? [] : group.map((f: any) => f?.id_name);
    const alloData = await this.getAllocationFromAllocationService(userId, alloShipper, alloStartDate, alloEndDate);
    
    const alloPayload = {
      userId,
      shipper: alloShipper,
      data: alloData,
      startDate: alloStartDate,
      endDate: alloEndDate,
      menu,
    };
    
    const allocationReview = await this.getAllocationReviewData(alloPayload);
    const allocationManagement = await this.getAllocationManagementData(alloPayload);
    //#endregion allocation

    //#region event
    const eventShipper = group.map((f: any) => f?.id);
    const eventTso = isTSO ? group.map((f: any) => f?.id) : isAdmin ? [] : [-1];
    
    const eventPayload = {
      userId, 
      shipper: eventShipper, 
      tso: eventTso, 
      menu,
      atDate
    };
    
    const offspecGas = await this.getOffspecGasData(eventPayload);
    const emergencyDifficultDay = await this.getEmerData(eventPayload);
    const ofo = await this.getOfoData(eventPayload);
    //#endregion event


    return {
      ...contract,
      [RELEASE_CAPACITY]: contractReleaseCapacity,
      ...nomination,
      [NOMINATION_ADJUSTMENT]: nominationAdjustment,
      [ALLOCATION_REVIEW]: allocationReview,
      [ALLOCATION_MANAGEMENT]: allocationManagement,
      [EVENT_OFFSPEC_GAS]: offspecGas,
      [EVENT_EMERGENCY_DIFFICULT_DAY]: emergencyDifficultDay,
      [EVENT_OF_IF]: ofo
    };
  }
}
