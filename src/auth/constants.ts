import { ConfigService } from '@nestjs/config';

// JWT secret should be loaded from environment variables for security
// This function is kept for backward compatibility but should use ConfigService
export function getJwtSecret(configService?: ConfigService): string {
  if (configService) {
    return configService.get<string>('JWT_SECRET') || '!B@Nl<Na.';
  }
  // Fallback for direct access (not recommended)
  return process.env.JWT_SECRET || '!B@Nl<Na.';
}

// Deprecated: Use getJwtSecret() with ConfigService instead
export const jwtConstants = {
  secret: process.env.JWT_SECRET || '!B@Nl<Na.',
};
