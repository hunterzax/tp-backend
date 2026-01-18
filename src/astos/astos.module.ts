// src/astos/astos.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AstosService } from './astos.service';
import { AstosController } from './astos.controller';
import { AstosRepository } from './astos.repository';
import { AstosUtils } from './astos.utils';
import { GrpcModule } from 'src/grpc/grpc.module';
import { PrismaModule } from 'prisma/prisma.module';
@Module({
  imports: [
    GrpcModule,
    PrismaModule,
    JwtModule.register({}),
  ],
  controllers: [AstosController],
  providers: [AstosService, AstosRepository, AstosUtils],
  exports: [AstosService],
})
export class AstosModule { }
