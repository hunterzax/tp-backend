import { Controller, Get, Inject, OnModuleInit, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { ClientGrpc, GrpcMethod } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { Response } from 'express';

// interface Request {
//   param: string;
// }

// interface Response {
//   message: string;
// }

// interface ExampleService {
//   SendData(data: Request): Observable<Response>;
// }

@Controller()
export class AppController implements OnModuleInit {
  // private exampleService: ExampleService;
  // private exampleServiceFastApi: ExampleService;

  constructor(
    private readonly appService: AppService,
    // @Inject('GO_SERVICE') private client: ClientGrpc,
    // @Inject('FASTAPI_CALCULATE_SERVICE') private clientFastApiCalculate: ClientGrpc,
  ) {}

  onModuleInit() {
    // this.exampleService = this.client.getService<ExampleService>('ExampleService');
    // this.exampleServiceFastApi = this.clientFastApiCalculate.getService<ExampleService>('ExampleService');
  }

  // http://10.100.101.15:8010/master/demoHtml
  @Get('demoHtml')
  demoHtml(@Res() res: Response, ) {
    return this.appService.demoHtml(res, null);
  }

  @Get()
  getHello() {
    return `hello i sad`
    // return this.appService.getHello();
  }

  @Get("1")
  getHello1() {
    return `hello i sad 1`
    // return this.appService.getHello();
  }
  @Get("2")
  getHello2() {
    return `hello i sad 2`
    // return this.appService.getHello();
  }

  @Get("1/1")
  getHello11() {
    return `hello i sad 1/1`
    // return this.appService.getHello();
  }
  @Get("1/1/1")
  getHello111() {
    return `hello i sad 1/1/1`
    // return this.appService.getHello();
  }

  // @GrpcMethod('ExampleService', 'GetData')
  // getData(request: any, metadata: any): any {
  //   return { data: `ฉันเอง, ${request.param}` };
  // }

  // @Get('grpcToGolang')
  // sendDataGolang(): Observable<Response> {
  //   return this.exampleService.SendData({ param: 'Hello Golang' });
  // }

  // @Get('grpcToFastApi')
  // sendDataToFastApi(): Observable<Response> {
  //   return this.exampleServiceFastApi.SendData({ param: 'Hello FastApi Calculate' });
  // }
}
