import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class EncryptResponseMiddleware implements NestMiddleware {
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>('ENCRYPT_SECRET_KEY');

    if (!key || key.length !== 32) {
      throw new Error('ENCRYPT_SECRET_KEY must be defined and 32 characters long');
    }

    this.secretKey = Buffer.from(key, 'utf8');
  }

  encrypt(text: string) {
    // Use a random IV per message; 12 bytes is recommended for GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      tag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  use(req: Request, res: Response, next: NextFunction) {
    const oldJson = res.json;

    res.json = (body: any) => {
      const jsonData = JSON.stringify(body);
      const encrypted = this.encrypt(jsonData);
      return oldJson.call(res, encrypted);
    };

    next();
  }
}
