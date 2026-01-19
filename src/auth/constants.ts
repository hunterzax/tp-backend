import { ConfigService } from '@nestjs/config';

// JWT secret should be loaded from environment variables for security
// This function is kept for backward compatibility but should use ConfigService
export function getJwtSecret(configService?: ConfigService): string {
  if (configService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET environment variable is not defined');
    return secret;
  }
  // Fallback for direct access (not recommended)
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not defined');
  return secret;
}

// Deprecated: Use getJwtSecret() with ConfigService instead
export const jwtConstants = {
  get secret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) return 'temporary_dummy_secret_for_build_only_CHANGE_THIS'; // Return a value to avoid build crashes if env is missing during build, but this is still safer than a real secret
    return secret;
  }
};
