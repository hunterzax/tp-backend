import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { EventService } from './event.service';
import { AuthGuard } from 'src/auth/auth.guard';

@Controller('event')
export class EventController {
  constructor(private readonly eventService: EventService) { }

  @Get('event-status')
  eventStatus() {
    return this.eventService.eventStatus();
  }

  @Get('event-doc-status')
  eventDocStatus() {
    return this.eventService.eventDocStatus();
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas')
  offspecGasAll(@Req() req: any, @Query() query: any) {
    const userId = req?.user?.sub;
    return this.eventService.offspecGasAll(query, userId);
  }

  @UseGuards(AuthGuard)
  @Patch('offspec-gas/:id')
  async updateStatus(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_status_id } = body;

    if (!id || !event_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const updateStatus = await this.eventService.updateStatus(
      id,
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(
      req,
      `offspec-gas/doc1`,
      'update-status',
      updateStatus,
    );

    return updateStatus;
  }

  // doc 1

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc1/pdf/:id')
  doc1PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc1PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc1/:id')
  doc1Find(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc1Find(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc1/history/:id')
  doc1History(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc1History(id, userId);
  }

  @UseGuards(AuthGuard)
  @Post('offspec-gas/doc1')
  async doc1Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryCreate =
      await this.eventService.doc1Create(body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `offspec-gas/doc1`,
      'create',
      changeModeZoneBaseInventoryCreate,
    );

    return changeModeZoneBaseInventoryCreate;
  }

  @UseGuards(AuthGuard)
  @Put('offspec-gas/doc1/:id')
  async doc1Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc1Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `offspec-gas/doc1`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // doc 2

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc2/ref-doc-use')
  doc2RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc2RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc2/email-group-for-event')
  doc2EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc2EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc2/shipper')
  doc2Shipper(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc2Shipper(userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc2/pdf/:id')
  doc2PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    // const userId = 99988; //tso 56
    // const userId = 99989; //shipper doc 57
    // const userId = 76; //shipper doc 58
    // const userId = 63;
    return this.eventService.doc2PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc2/pdf/tsoview/:id')
  doc2PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    // const userId = null
    // const userId = req?.user?.sub;
    // const userId = 99988; //tso 79
    // const userId = 0; //shipper doc 78
    return this.eventService.doc2PDF(id, userIds, res, shipperIds);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc2/:id')
  doc2Find(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc2Find(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc2/history/:id')
  doc2History(@Req() req: any, @Param('id') id: any, @Query() query: any) {
    const { tso } = query;
    const userId = req?.user?.sub;
    //  tso ส่ง id runnumber
    return this.eventService.doc2History(id, userId, tso);
  }

  @UseGuards(AuthGuard)
  @Post('offspec-gas/doc2')
  async doc2Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc2Create = await this.eventService.doc2Create(body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `offspec-gas/doc2`,
      'create',
      doc2Create,
    );

    return doc2Create;
  }

  @UseGuards(AuthGuard)
  @Post('offspec-gas/doc2/edit/:id')
  async doc2Edit(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc2Edit = await this.eventService.doc2Edit(id, body, req?.user?.sub);

    await this.eventService.writeReq(req, `offspec-gas/doc2`, 'edit', doc2Edit);

    return doc2Edit;
  }

  @UseGuards(AuthGuard)
  @Put('offspec-gas/doc2/:id')
  async doc2Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc2Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `offspec-gas/doc3`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // doc 3

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc3/ref-doc-use')
  doc3RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc3RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc3/email-group-for-event')
  doc3EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc3EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc3/shipper')
  doc3Shipper(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc3Shipper(userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc3/pdf/:id')
  doc3PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    // const userId = 99988; //tso 79
    // const userId = 99989; //shipper doc 78
    return this.eventService.doc3PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc3/pdf/tsoview/:id')
  doc3PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { shipperId } = query;
    // console.log('shipperId : ', shipperId);
    // const userId = Number(shipperId);
    const userId = req?.user?.sub;
    // const userId = 99988; //tso 79
    // const userId = 99989; //shipper doc 78
    return this.eventService.doc3PDF(id, userId, res, shipperId && Number(shipperId) || null); 
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc3/:id')
  doc3Find(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc3Find(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('offspec-gas/doc3/history/:id')
  doc3History(@Req() req: any, @Param('id') id: any, @Query() query: any) {
    const { tso } = query;
    const userId = req?.user?.sub;
    return this.eventService.doc3History(id, userId, tso);
  }

  @UseGuards(AuthGuard)
  @Post('offspec-gas/doc3')
  async doc3Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc3Create = await this.eventService.doc3Create(body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `offspec-gas/doc3`,
      'create',
      doc3Create,
    );

    return doc3Create;
  }

  @UseGuards(AuthGuard)
  @Post('offspec-gas/doc3/edit/:id')
  async doc3Edit(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc3Edit = await this.eventService.doc3Edit(id, body, req?.user?.sub);

    await this.eventService.writeReq(req, `offspec-gas/doc3`, 'edit', doc3Edit);

    return doc3Edit;
  }

  @UseGuards(AuthGuard)
  @Put('offspec-gas/doc3/:id')
  async doc3Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc3Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `offspec-gas/doc3`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // emer

  @Get('emer/event-type')
  emerEventType() {
    return this.eventService.emerEventType();
  }

  @Get('emer/event-termission')
  emerEventTermission() {
    return this.eventService.emerEventTermission();
  }

  @Get('emer/event-status')
  emerEventStatus() {
    return this.eventService.emerEventStatus();
  }

  @Get('emer/event-doc-status')
  emerEventDocStatus() {
    return this.eventService.emerEventDocStatus();
  }

  @UseGuards(AuthGuard)
  @Get('emer')
  emerAll(@Req() req: any, @Query() query: any) {
    const userId = req?.user?.sub;
    return this.eventService.emerAll(query, userId);
  }

  @UseGuards(AuthGuard)
  @Patch('emer/:id')
  async emerUpdateStatus(
    @Body() body: any,
    @Req() req: any,
    @Param('id') id: any,
  ) {
    const { event_status_id } = body;

    if (!id || !event_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const updateStatus = await this.eventService.emerUpdateStatus(
      id,
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(
      req,
      `emergency-difficult-day/doc3.9`,
      'update-status',
      updateStatus,
    );

    return updateStatus;
  }

  // doc 3.9

  @UseGuards(AuthGuard)
  @Post('emer/generatedoc39and4')
  async generatedoc39and4(@Body() body: any, @Req() req: any) {
    // const { event_date } = body;

    // if (!event_date) {
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.BAD_REQUEST,
    //       error: 'Missing required fields',
    //     },
    //     HttpStatus.BAD_REQUEST,
    //   );
    // }

    const generatedoc39and4 = await this.eventService.generatedoc39and4(
      body,
      req?.user?.sub,
    );

    // await this.eventService.writeReq(req, `emer/doc39`, 'create', generatedoc39and4);

    return generatedoc39and4;
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc39/email-group-for-event')
  doc39EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc39EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc39/shipper')
  doc39Shipper(@Req() req: any) {
    const userId = req?.user?.sub;
    // const userId = 63;
    return this.eventService.doc39Shipper(userId);
  }

  // http://10.100.101.15:8010/master/event/emer/doc39/pdf/30
  @UseGuards(AuthGuard)
  @Get('emer/doc39/pdf/:id')
  doc39PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    // const userId = 99988; //tso 56
    // const userId = 99989; //shipper doc 57
    // const userId = 76; //shipper doc 58
    // const userId = 63;
    return this.eventService.doc39PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc39/pdf/tsoview/:id')
  doc39PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    // const userId = null
    // const userId = req?.user?.sub;
    // const userId = 99988; //tso 79
    // const userId = 0; //shipper doc 78
    return this.eventService.doc39PDF(id, userIds, res, shipperIds);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc39/:id')
  doc39Find(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc39Find(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc39/history/:id')
  doc39History(@Req() req: any, @Param('id') id: any, @Query() query: any) {
    const { tso } = query;
    const userId = req?.user?.sub;
    //  tso ส่ง id runnumber
    return this.eventService.doc39History(id, userId, tso);
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc39')
  async doc39Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc39Create = await this.eventService.doc39Create(
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(req, `emer/doc39`, 'create', doc39Create);

    return doc39Create;
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc39/edit/:id')
  async doc39Edit(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc39Edit = await this.eventService.doc39Edit(
      id,
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(req, `emer/doc39`, 'edit', doc39Edit);

    return doc39Edit;
  }

  @UseGuards(AuthGuard)
  @Put('emer/doc39/:id')
  async doc39Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc39Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `emer/doc3`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // doc 4
  // gen ยัง

  @UseGuards(AuthGuard)
  @Get('emer/doc4/ref-doc-use')
  doc4RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc4RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc4/order')
  doc4Order(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc4Order(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc4/email-group-for-event')
  doc4EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc4EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc4/shipper')
  doc4Shipper(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc4Shipper(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc4/pdf/:id')
  doc4PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    //  const userId = 99988; //tso 56
    // const userId = 99989; //shipper doc 57
    // const userId = 76; //shipper doc 58
    // const userId = 63;
    return this.eventService.doc4PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc4/pdf/tsoview/:id')
  doc4PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    return this.eventService.doc4PDF(id, userIds, res, shipperIds);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc4/version/:id')
  doc4FindVersion(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc4FindVersion(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc4/version/doc/:id')
  doc4FindDoc(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc4FindDoc(id, userId);
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc4')
  async doc4Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc4Create = await this.eventService.doc4Create(body, req?.user?.sub);

    await this.eventService.writeReq(req, `emer/doc4`, 'create', doc4Create);

    return doc4Create;
  }

  @UseGuards(AuthGuard)
  @Put('emer/doc4/:id')
  async doc4Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc4Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `emer/doc4`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // doc 5

  @UseGuards(AuthGuard)
  @Get('emer/doc5/ref-doc-use')
  doc5RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc5RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc5/email-group-for-event')
  doc5EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc5EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc5/shipper')
  doc5Shipper(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc5Shipper(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc5/pdf/:id')
  doc5PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc5PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc5/pdf/tsoview/:id')
  doc5PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    // const userId = null
    // const userId = req?.user?.sub;
    // const userId = 99988; //tso 79
    // const userId = 0; //shipper doc 78
    return this.eventService.doc5PDF(id, userIds, res, shipperIds);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc5/:id')
  doc5Find(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc5Find(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc5/history/:id')
  doc5History(@Req() req: any, @Param('id') id: any, @Query() query: any) {
    const { tso } = query;
    const userId = req?.user?.sub;
    //  tso ส่ง id runnumber
    return this.eventService.doc5History(id, userId, tso);
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc5')
  async doc5Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc5Create = await this.eventService.doc5Create(body, req?.user?.sub);

    await this.eventService.writeReq(req, `emer/doc5`, 'create', doc5Create);

    return doc5Create;
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc5/edit/:id')
  async doc5Edit(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc39Edit = await this.eventService.doc5Edit(
      id,
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(req, `emer/doc5`, 'edit', doc39Edit);

    return doc39Edit;
  }

  @UseGuards(AuthGuard)
  @Put('emer/doc5/:id')
  async doc5Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc5Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `emer/doc5`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // doc 6

  @UseGuards(AuthGuard)
  @Get('emer/doc6/ref-doc-use')
  doc6RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc6RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc6/email-group-for-event')
  doc6EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc6EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc6/nompoint')
  doc6Nompoint(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc6Nompoint(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc6/pdf/:id')
  doc6PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc6PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc6/pdf/tsoview/:id')
  doc6PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    // const userId = null
    // const userId = req?.user?.sub;
    // const userId = 99988; //tso 79
    // const userId = 0; //shipper doc 78
    return this.eventService.doc6PDF(id, userIds, res, shipperIds);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc6/:id')
  doc6Find(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc6Find(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc6/history/:id')
  doc6History(@Req() req: any, @Param('id') id: any, @Query() query: any) {
    const { tso } = query;
    const userId = req?.user?.sub;
    //  tso ส่ง id runnumber
    return this.eventService.doc6History(id, userId, tso);
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc6')
  async doc6Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc4Create = await this.eventService.doc6Create(body, req?.user?.sub);

    await this.eventService.writeReq(req, `emer/doc6`, 'create', doc4Create);

    return doc4Create;
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc6/edit/:id')
  async doc6Edit(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc6Edit = await this.eventService.doc6Edit(id, body, req?.user?.sub);

    await this.eventService.writeReq(req, `emer/doc6`, 'edit', doc6Edit);

    return doc6Edit;
  }

  @UseGuards(AuthGuard)
  @Put('emer/doc6/:id')
  async doc6Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc6Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `emer/doc6`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // ofo

  @Get('ofo/event-type')
  ofoEventType() {
    return this.eventService.ofoEventType();
  }

  @Get('ofo/event-termission')
  ofoEventTermission() {
    return this.eventService.ofoEventTermission();
  }

  @Get('ofo/event-status')
  ofoEventStatus() {
    return this.eventService.emerEventStatus();
  }

  @Get('ofo/event-doc-status')
  ofoEventDocStatus() {
    return this.eventService.emerEventDocStatus();
  }

  @UseGuards(AuthGuard)
  @Get('ofo')
  ofoAll(@Req() req: any, @Query() query: any) {
    const userId = req?.user?.sub;
    return this.eventService.ofoAll(query, userId);
  }

  @UseGuards(AuthGuard)
  @Patch('ofo/:id')
  async ofoUpdateStatus(
    @Body() body: any,
    @Req() req: any,
    @Param('id') id: any,
  ) {
    const { event_status_id } = body;

    if (!id || !event_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const updateStatus = await this.eventService.ofoUpdateStatus(
      id,
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(
      req,
      `ofo/doc78`,
      'update-status',
      updateStatus,
    );

    return updateStatus;
  }

  // doc 7
  // event/ofo/doc7/updateRef
  @UseGuards(AuthGuard)
  @Put('ofo/doc7/updateRef')
  async doc7updateRef(@Body() body: any, @Req() req: any) {
    console.log('. . .');
   
    const doc7updateRef = await this.eventService.doc7updateRef(
      body,
      req?.user?.sub,
    );

    // await this.eventService.writeReq(req, `emer/doc7`, 'create', doc7updateRef);

    return doc7updateRef;
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/ref-master')
  doc7RefMaster(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc7RefMaster(userId);
  }

  @UseGuards(AuthGuard)
  @Post('ofo/generatedoc7')
  async generatedoc7(@Body() body: any, @Req() req: any) {
    // const { event_date } = body;

    // if (!event_date) {
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.BAD_REQUEST,
    //       error: 'Missing required fields',
    //     },
    //     HttpStatus.BAD_REQUEST,
    //   );
    // }

    const generatedoc7 = await this.eventService.generatedoc7(
      body,
      req?.user?.sub,
    );

    // await this.eventService.writeReq(req, `emer/doc39`, 'create', generatedoc7);

    return generatedoc7;
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/ref-doc-use')
  doc7RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc7RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/email-group-for-event')
  doc7EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc7EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/nompoint')
  doc7Nompoint(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc7Nompoint(userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/order')
  doc7Order(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc7Order(userId);
  }

  @UseGuards(AuthGuard)
  @Post('ofo/doc7')
  async doc7Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc7Create = await this.eventService.doc7Create(body, req?.user?.sub);

    await this.eventService.writeReq(req, `emer/doc7`, 'create', doc7Create);

    return doc7Create;
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/version/:id')
  doc7FindVersion(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc7FindVersion(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/version/doc/:id')
  doc7FindDoc(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc7FindDoc(id, userId);
  }

  @UseGuards(AuthGuard)
  @Put('ofo/doc7/:id')
  async doc7Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc7Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `ofo/doc7`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/pdf/:id')
  doc7PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    // const userId = 99988;
    // const userId = 73;
    return this.eventService.doc7PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc7/pdf/tsoview/:id')
  doc7PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    return this.eventService.doc7PDF(id, userIds, res, shipperIds);
  }

  

  // doc 8

  @UseGuards(AuthGuard)
  @Get('ofo/doc8/ref-doc-use')
  doc8RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc8RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc8/email-group-for-event')
  doc8EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc8EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc8/shipper')
  doc8Shipper(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc8Shipper(userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc8/pdf/:id')
  doc8PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc8PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc8/pdf/tsoview/:id')
  doc8PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    return this.eventService.doc8PDF(id, userIds, res, shipperIds);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc8/:id')
  doc8Find(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc8Find(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('ofo/doc8/history/:id')
  doc8History(@Req() req: any, @Param('id') id: any, @Query() query: any) {
    const { tso } = query;
    const userId = req?.user?.sub;
    //  tso ส่ง id runnumber
    return this.eventService.doc8History(id, userId, tso);
  }

  @UseGuards(AuthGuard)
  @Post('ofo/doc8')
  async doc8Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc8Create = await this.eventService.doc8Create(body, req?.user?.sub);

    await this.eventService.writeReq(req, `ofo/doc8`, 'create', doc8Create);

    return doc8Create;
  }

  @UseGuards(AuthGuard)
  @Post('ofo/doc8/edit/:id')
  async doc8Edit(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc39Edit = await this.eventService.doc8Edit(
      id,
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(req, `ofo/doc8`, 'edit', doc39Edit);

    return doc39Edit;
  }

  @UseGuards(AuthGuard)
  @Put('ofo/doc8/:id')
  async doc8Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc8Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `ofo/doc8`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  // doc 41

  @UseGuards(AuthGuard)
  @Get('emer/doc41/shipper')
  doc44Shipper(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc41Shipper(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc41/ref-doc-use')
  doc41RefDocUsed(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc41RefDocUsed(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc41/email-group-for-event')
  doc41EmailGroupForEvent(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc41EmailGroupForEvent(userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc41/order')
  doc41Order(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc41Order(userId);
  }

  @UseGuards(AuthGuard)
  @Post('emer/doc41')
  async doc41Create(@Body() body: any, @Req() req: any) {
    const { event_date } = body;

    if (!event_date) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const doc7Create = await this.eventService.doc41Create(
      body,
      req?.user?.sub,
    );

    await this.eventService.writeReq(req, `emer/doc41`, 'create', doc7Create);

    return doc7Create;
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc41/version/:id')
  doc41FindVersion(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc41FindVersion(id, userId);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc41/version/doc/:id')
  doc41FindDoc(@Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    return this.eventService.doc41FindDoc(id, userId);
  }

  @UseGuards(AuthGuard)
  @Put('emer/doc41/:id')
  async doc41Action(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const { event_doc_status_id } = body;

    if (!id || !event_doc_status_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeModeZoneBaseInventoryAction =
      await this.eventService.doc41Action(id, body, req?.user?.sub);

    await this.eventService.writeReq(
      req,
      `emer/doc41`,
      'action',
      changeModeZoneBaseInventoryAction,
    );

    return changeModeZoneBaseInventoryAction;
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc41/pdf/:id')
  doc41PDF(@Res() res: Response, @Req() req: any, @Param('id') id: any) {
    const userId = req?.user?.sub;
    // const userId = 99988;
    return this.eventService.doc41PDF(id, userId, res);
  }

  @UseGuards(AuthGuard)
  @Get('emer/doc41/pdf/tsoview/:id')
  doc41PDFtsoView(
    @Res() res: Response,
    @Req() req: any,
    @Param('id') id: any,
    @Query() query: any,
  ) {
    const { userId, shipperId } = query;
    const userIds = Number(userId);
    const shipperIds = Number(shipperId);
    return this.eventService.doc41PDF(id, userIds, res, shipperIds);
  }
}
