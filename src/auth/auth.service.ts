import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

export type User = any;

@Injectable()
export class AuthService {
  private failedAttempts = new Map<string, { count: number; lockUntil: number }>();
  private readonly maxAttempts = 10; // attempts
  private readonly windowMs = 15 * 60 * 1000; // 15 minutes
  private readonly lockMs = 15 * 60 * 1000; // lockout duration
  private readonly users = [
    {
      userId: 1,
      username: process.env.ADMIN_USERNAME || 'admin',
      // Expect bcrypt hash provided via env; if missing, sign-in will always fail
      password: process.env.ADMIN_PASSWORD_HASH || '',
    },
  ];

  constructor(
    private jwtService: JwtService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) {}

  async findOne(username: string): Promise<any | undefined> {
    return this.users.find((user) => user.username === username);
  }

  async signIn(
    username: string,
    pass: string,
  ): Promise<{ accessToken: string; data: any }> {
    const now = Date.now();
    const state = this.failedAttempts.get(username);
    if (state && state.lockUntil && state.lockUntil > now) {
      throw new UnauthorizedException();
    }
    const user = await this.findOne(username);
    if (!user || !user.password) {
      this.registerFailure(username);
      throw new UnauthorizedException();
    }
    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) {
      this.registerFailure(username);
      throw new UnauthorizedException();
    }
    this.failedAttempts.delete(username);
    const payload = {
      sub: user.userId,
      username: user.username,
      type: 'access',
    };
    return {
      data: payload,
      accessToken: await this.jwtService.signAsync(payload),
    };
  }

  private registerFailure(username: string) {
    const now = Date.now();
    const current = this.failedAttempts.get(username);
    if (!current || current.lockUntil < now - this.windowMs) {
      this.failedAttempts.set(username, { count: 1, lockUntil: 0 });
      return;
    }
    const next = { ...current, count: current.count + 1 };
    if (next.count >= this.maxAttempts) {
      next.lockUntil = now + this.lockMs;
    }
    this.failedAttempts.set(username, next);
  }

  async genPass() {
    // Generate a random 12-char password instead of using a hard-coded value
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
    let password = '';
    for (let i = 0; i < 12; i++) {
      const idx = crypto.randomInt(0, charset.length);
      password += charset[idx];
    }
    const salt = await bcrypt.genSalt();
    const hash = await bcrypt.hash(password, salt);
    const isMatch = await bcrypt.compare(password, hash);
    return { hash, isMatch, password };
  }

  async createCsrfToken({userId}:any) {
    const csrfToken = crypto.randomBytes(32).toString('hex');

    // await this.cacheService.set(`csrf:${userId}`, csrfToken, 3600);
    return csrfToken
  }

  async validateCsrfToken(token: string, key: string, prefix: string) {
    const keys = `${prefix}${key}`
    // let testCache: any = await this.cacheService.get(keys);
    // await this.cacheService.del(keys)
    // console.log('testCache : ', testCache);

    // return token === testCache;
  }
}
