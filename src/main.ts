// nuja-24092025 21:32
import {
  BaseExceptionFilter,
  HttpAdapterHost,
  NestFactory,
} from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger, VersioningType, ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import morgan from 'morgan';
import * as bodyParser from 'body-parser';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import './instrument.js';
import compression from 'compression';
import helmet from 'helmet';
import axios from 'axios';

import * as session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';

// import * as dotenv from 'dotenv';
// dotenv.config(); // 🧠 ตรงนี้จะ force โหลด .env ให้ process.env


async function bootstrap() {
  // Set sane defaults for outbound HTTP to reduce SSRF blast radius
  axios.defaults.timeout = 10000; // 10s
  axios.defaults.maxRedirects = 3;
  // console.log('✅ process.env.IP_URL (main.ts):', process.env.IP_URL); // ต้องเห็น 34.87.62.61

  // console.log('Current working directory:', process.cwd());

  // const sslKeyPath = path.resolve(
  //   process.cwd(),
  //   'src',
  //   'ssl',
  //   'ssl_private.key',
  // );
  // const sslCertPath = path.resolve(process.cwd(), 'src', 'ssl', 'ssl.crt');

  // Resolve SSL paths based on environment
  const isDev = process.env.NODE_ENV === 'development';
  const sslKeyPath = isDev
    ? path.resolve(process.cwd(), 'src', 'ssl', 'ssl_private.key')
    : path.resolve(__dirname, process.env.SSL_KEY_PATH);

  const sslCertPath = isDev
    ? path.resolve(process.cwd(), 'src', 'ssl', 'ssl.crt')
    : path.resolve(__dirname, process.env.SSL_CERT_PATH);


  if (!fs.existsSync(sslKeyPath) || !fs.existsSync(sslCertPath)) {
    throw new Error(`SSL files not found. Make sure the following files exist:
    - ${sslKeyPath}
    - ${sslCertPath}`);
  }
  const httpsOptions = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath),
  };
  const app = await NestFactory.create(AppModule, {
    httpsOptions,
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  // const app = await NestFactory.create(AppModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'example',
      protoPath: path.join(__dirname, '../example.proto'),
      url: '0.0.0.0:50051',
    },
  });

  const configService = app.get(ConfigService);
  const port = configService.get<string>('PORT');
  const logger = new Logger('Bootstrap');
  const { httpAdapter } = app.get(HttpAdapterHost);
  // Sentry.setupNestErrorHandler(app, new BaseExceptionFilter(httpAdapter));
  app.useGlobalFilters(new BaseExceptionFilter(httpAdapter));


  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.enableCors({
    origin: (origin, callback) => {
      const raw = process.env.ALLOWED_ORIGINS || '';
      const allow = raw.split(',').map((s) => s.trim()).filter(Boolean);
      // Same-origin or non-browser requests (no origin) are allowed
      if (!origin) return callback(null, true);
      if (origin === 'null') return callback(new Error('CORS null origin not allowed'), false);
      if (allow.includes(origin)) return callback(null, true);
      return callback(new Error('CORS not allowed'), false);
    },
    credentials: true,
  });

  // app.use((req, res, next) => {
  //   console.log('---');
  //   next();
  // });

  // ไม่ต้องเอาขึ้น ไป UAT/PRD
  // process.env.NODE_ENV !== 'production' && app.setGlobalPrefix('master');
  // process.env.NODE_ENV !== 'production' && 
  // app.setGlobalPrefix('master');

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // APIs rarely need CSP; disable to avoid breaking clients
    xPoweredBy: false,
  }));
  if (process.env.NODE_ENV === 'production') {
    app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true, preload: false }));
  }

  app.use(compression());
  app.use(morgan('tiny'));
  app.use(bodyParser.json({ limit: '500mb' }));
  app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  // CSRF safeguard for stateless JWT: block state-changing requests that carry cookies without Authorization header
  app.use((req, res, next) => {
    const method = req.method?.toUpperCase();
    const stateChanging = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (stateChanging) {
      const hasCookie = Boolean(req.headers['cookie']);
      const hasAuth = Boolean(req.headers['authorization']);
      if (hasCookie && !hasAuth) {
        return res.status(403).json({ message: 'Blocked: state-changing requests with cookies must use Authorization header.' });
      }
    }
    next();
  });
  app.use((req, res, next) => {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=600, max=100');
    next();
  });

  // app.use((req, res, next) => {
  //   res.setHeader('Connection', 'keep-alive');
  //   next();
  // });

  await app.startAllMicroservices();
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: ${port}`);
}
bootstrap();
