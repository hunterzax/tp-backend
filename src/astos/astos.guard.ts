import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import axios from 'axios';
import { assertSafeExternalUrl, tryParseUrl } from 'src/common/utils/url.util';

function sanitizeAstosHost(rawHost?: string): string {
  const hostCandidate = rawHost?.trim();
  if (!hostCandidate) {
    throw new Error('ASTOS host is not configured');
  }
  const requiresWrapping = hostCandidate.includes(':') && !hostCandidate.startsWith('[');
  const normalizedHost = requiresWrapping ? `[${hostCandidate}]` : hostCandidate;
  const parsed = tryParseUrl(`https://${normalizedHost}`);
  if (!parsed) {
    throw new Error('ASTOS host is invalid');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentials not allowed in ASTOS host');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('ASTOS host must not include path, query, or fragment');
  }
  return parsed.hostname;
}

function sanitizeAstosPort(rawPort?: string): string {
  const portCandidate = rawPort?.trim();
  if (!portCandidate) {
    return '';
  }
  if (!/^\d{1,5}$/.test(portCandidate)) {
    throw new Error('ASTOS port must be numeric');
  }
  const numericPort = Number(portCandidate);
  if (numericPort < 1 || numericPort > 65535) {
    throw new Error('ASTOS port is out of range');
  }
  return portCandidate;
}

@Injectable()
export class AstosGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  private resolvePublicKeyUrl(): string {
    const configuredUrl = process.env.ASTOS_PUBLIC_KEY_URL?.trim();
    if (configuredUrl) {
      assertSafeExternalUrl(configuredUrl);
      return configuredUrl;
    }

    const host = sanitizeAstosHost(process.env.IP_URL);
    const port = sanitizeAstosPort(process.env.KONG_PORT);
    const url = new URL('https://placeholder');
    url.hostname = host;
    url.port = port;
    url.pathname = '/api/jwt/public-key';
    const finalUrl = url.toString();
    assertSafeExternalUrl(finalUrl);
    return finalUrl;
  }

  async getPublicKey(): Promise<string | null> {
    try {
      const url = this.resolvePublicKeyUrl();
      const response = await axios.get(url, { timeout: 5000, maxRedirects: 3 });
      const publicKey = Object.values(response.data.publicKeys)[0] as string; // แคสต์ publicKey ให้เป็น string
      return publicKey;
    } catch (error) {
      console.error('Error fetching public key');
      return null;
    }
  }

  async verifyToken(token: string): Promise<any> {
    const publicKey = await this.getPublicKey();
    if (!publicKey) {
      console.error('Public Key not available.');
      return false;
    }

    try {
      const decoded = this.jwtService.verify(token, { secret: publicKey, algorithms: ['RS256'] });
      return decoded;
    } catch (err) {
      console.error('Token verification failed');
      return false;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      console.error('Authorization header is missing');
      return false;
    }
  
    const token = authHeader.split(' ')[1]; // ดึง token จาก header
    
    const decoded = await this.verifyToken(token);
  
    if (!decoded) {
      console.error('Token verification failed');
      return false;
    }
    request['user'] = decoded; // ใส่ข้อมูล user ลงใน request object
    return true;
  }
}
